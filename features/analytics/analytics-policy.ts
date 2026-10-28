/**
 * Where RuneSpace's product analytics may run (issue #413). Pure and shared by
 * the browser SDK wrapper and the best-effort server reporter, so the two
 * cannot disagree about when tracking is allowed. See `docs/analytics.md`.
 *
 * Tracking is allowed only when ALL of these hold:
 * - a PostHog project token is configured (build-time, `NEXT_PUBLIC_*`);
 * - the page is served from exactly the production public host, or from the
 *   exact preview host `pr-<n>.runespace.qcfailed.com` of a pull request that
 *   the build explicitly lists (preview analytics is off unless deliberately
 *   enabled; see `NEXT_PUBLIC_ANALYTICS_PREVIEW_PRS` below);
 * - the visitor's choice satisfies the consent model below (by default they
 *   have explicitly said yes, before anything is stored or sent);
 * - their browser is not sending a Global Privacy Control or Do Not Track
 *   signal, which wins over any stored "yes".
 *
 * Anything else is a silent no-op: the game never depends on analytics.
 */

/** The production host: always eligible once the token is configured. */
export const ANALYTICS_PRODUCTION_HOSTNAME = "runespace.qcfailed.com";

/**
 * A pull-request preview host, exactly `pr-<number>.runespace.qcfailed.com`
 * (no leading zero, at most seven digits). Eligible only when that PR number is
 * listed in `NEXT_PUBLIC_ANALYTICS_PREVIEW_PRS`.
 */
const PREVIEW_HOST_PATTERN = /^pr-([1-9][0-9]{0,6})\.runespace\.qcfailed\.com$/;
const MAX_PREVIEW_PRS = 20;

/** PostHog US Cloud ingestion host (issue #413), used when none is configured. */
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

/**
 * The consent model. `"opt-in"` (shipped) means no PostHog storage or network
 * traffic, and no server-side event, until the visitor presses Accept. Because
 * the visitor's jurisdiction cannot be determined reliably, it applies to
 * everyone. `"opt-out"` would run analytics until the visitor declines. Which
 * to ship is an owner decision (see `docs/analytics.md`); this constant is the
 * only place it is made.
 */
export type AnalyticsConsentModel = "opt-in" | "opt-out";
export const ANALYTICS_CONSENT_MODEL: AnalyticsConsentModel = "opt-in";

/**
 * The visitor's explicit choice, a first-party cookie (rather than storage the
 * SDK owns) so the server reporter can honor it too. It is a preference record,
 * not analytics.
 */
export const ANALYTICS_CHOICE_COOKIE = "rs_analytics_choice";
export const ANALYTICS_CHOICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Session cookie the browser keeps in step with its Global Privacy Control /
 * Do Not Track state, so the server reporter honors a signal even when a proxy
 * or the request path does not forward `Sec-GPC` / `DNT`.
 */
export const ANALYTICS_SIGNAL_COOKIE = "rs_analytics_signal";

export type AnalyticsChoice = "on" | "off";

/** Fired on `window` when the visitor changes their analytics choice. */
export const ANALYTICS_CHOICE_EVENT = "runespace:analytics-choice";

export type AnalyticsConfig = {
  token: string;
  apiHost: string;
  /** PR numbers whose preview hosts may send analytics. Usually empty. */
  previewPrs: readonly number[];
};

/**
 * Parse `NEXT_PUBLIC_ANALYTICS_PREVIEW_PRS`: a comma-separated list of PR
 * numbers (for example `414` or `414,420`). Unset or empty means none. The
 * whole value is rejected, never partly honored, if any entry is not a plain
 * positive integer, or if it lists more than twenty, so a typo cannot widen
 * what is tracked.
 */
export function parsePreviewPrs(raw: string | undefined): readonly number[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];
  const entries = trimmed.split(",").map((entry) => entry.trim());
  if (entries.length > MAX_PREVIEW_PRS) return [];
  if (!entries.every((entry) => /^[1-9][0-9]{0,6}$/.test(entry))) return [];
  return [...new Set(entries.map(Number))];
}

/**
 * Parse the public build-time values. A missing token, or a host that is not an
 * https origin, yields `null` (analytics disabled) rather than an error, so a
 * bad value can never break a build or a page.
 */
export function resolveAnalyticsConfig(raw: {
  token?: string | undefined;
  host?: string | undefined;
  previewPrs?: string | undefined;
}): AnalyticsConfig | null {
  const token = raw.token?.trim();
  if (!token || !/^phc_[A-Za-z0-9]{20,}$/.test(token)) return null;
  const host = raw.host?.trim() || DEFAULT_POSTHOG_HOST;
  try {
    const url = new URL(host);
    if (url.protocol !== "https:") return null;
    return { token, apiHost: url.origin, previewPrs: parsePreviewPrs(raw.previewPrs) };
  } catch {
    return null;
  }
}

/**
 * The deployment config. Next inlines each `process.env.NEXT_PUBLIC_*` literal
 * at build time into both the browser and server bundles, so these names must
 * be referenced literally (never through a dynamic key).
 */
export const analyticsConfig: AnalyticsConfig | null = resolveAnalyticsConfig({
  token: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  previewPrs: process.env.NEXT_PUBLIC_ANALYTICS_PREVIEW_PRS,
});

/** Which deployment a request or page belongs to, derived only from its host. */
export type AnalyticsEnvironment =
  | { environment: "production"; host: string }
  | { environment: "preview"; host: string; pr: number };

function normalizedHostname(host: string | null | undefined): string | undefined {
  if (!host) return undefined;
  const match = /^([a-z0-9.-]+)(?::\d{1,5})?$/i.exec(host.trim());
  return match ? match[1]!.toLowerCase().replace(/\.$/, "") : undefined;
}

/** Whether a hostname is one of RuneSpace's own (production or any preview). */
export function isRuneSpaceHostname(hostname: string): boolean {
  return hostname === ANALYTICS_PRODUCTION_HOSTNAME || PREVIEW_HOST_PATTERN.test(hostname);
}

/**
 * Decide which analytics environment, if any, a host is. Accepts a bare
 * hostname (`location.hostname`) or a `Host` header value with an optional
 * port, and nothing else: no other subdomain, no suffix matching, no userinfo.
 * Production is the exact production host and never depends on the preview
 * list, so enabling a preview cannot loosen it. A preview qualifies only when
 * its PR number is in `previewPrs`. The environment comes from the host alone,
 * so a production page can never be labeled preview or the reverse. Everything
 * else (localhost, CI, unlisted previews, arbitrary hosts) is `null`.
 */
export function resolveAnalyticsEnvironment(
  host: string | null | undefined,
  previewPrs: readonly number[] = [],
): AnalyticsEnvironment | null {
  const hostname = normalizedHostname(host);
  if (!hostname) return null;
  if (hostname === ANALYTICS_PRODUCTION_HOSTNAME)
    return { environment: "production", host: hostname };
  const match = PREVIEW_HOST_PATTERN.exec(hostname);
  if (!match) return null;
  const pr = Number(match[1]);
  return previewPrs.includes(pr) ? { environment: "preview", host: hostname, pr } : null;
}

/** The properties that mark every analytics event with its environment. */
export function environmentProperties(
  env: AnalyticsEnvironment,
): { environment: "production" } | { environment: "preview"; preview_pr: number } {
  return env.environment === "production"
    ? { environment: "production" }
    : { environment: "preview", preview_pr: env.pr };
}

function cookieValue(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return undefined;
}

/** The visitor's saved choice from a `Cookie` header, if any. */
export function readAnalyticsChoice(
  cookieHeader: string | null | undefined,
): AnalyticsChoice | undefined {
  const value = cookieValue(cookieHeader, ANALYTICS_CHOICE_COOKIE);
  return value === "on" || value === "off" ? value : undefined;
}

/** Whether a choice (or its absence) satisfies the consent model. */
export function consentAllows(
  choice: AnalyticsChoice | undefined,
  model: AnalyticsConsentModel = ANALYTICS_CONSENT_MODEL,
): boolean {
  return model === "opt-in" ? choice === "on" : choice !== "off";
}

/** Whether the browser-maintained privacy-signal cookie is set. */
export function hasSignalCookie(cookieHeader: string | null | undefined): boolean {
  return cookieValue(cookieHeader, ANALYTICS_SIGNAL_COOKIE) === "1";
}

/** Global Privacy Control / Do Not Track, as exposed by the browser or its headers. */
export function hasPrivacySignal(signals: {
  globalPrivacyControl?: boolean | string | null | undefined;
  doNotTrack?: string | null | undefined;
}): boolean {
  const gpc = signals.globalPrivacyControl;
  if (gpc === true || gpc === "1") return true;
  const dnt = signals.doNotTrack;
  return dnt === "1" || dnt === "yes";
}
