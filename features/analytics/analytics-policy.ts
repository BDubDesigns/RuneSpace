/**
 * Where RuneSpace's product analytics may run (issue #413). Pure and shared by
 * the browser SDK wrapper and the best-effort server reporter, so the two
 * cannot disagree about when tracking is allowed. See `docs/analytics.md`.
 *
 * Tracking is allowed only when ALL of these hold:
 * - a PostHog project token is configured (build-time, `NEXT_PUBLIC_*`);
 * - the page is served from exactly the production public host;
 * - the visitor has not chosen to opt out, and their browser is not sending a
 *   Global Privacy Control or Do Not Track signal.
 *
 * Anything else is a silent no-op: the game never depends on analytics.
 */

/** The only host that may send analytics. Previews and localhost never do. */
export const ANALYTICS_PRODUCTION_HOSTNAME = "runespace.qcfailed.com";

/** PostHog US Cloud ingestion host (issue #413), used when none is configured. */
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

/** First-party opt-out flag: a cookie so the server reporter can honor it too. */
export const ANALYTICS_OPT_OUT_COOKIE = "rs_analytics_optout";
export const ANALYTICS_OPT_OUT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Fired on `window` when the visitor changes their analytics choice. */
export const ANALYTICS_CHOICE_EVENT = "runespace:analytics-choice";

export type AnalyticsConfig = { token: string; apiHost: string };

/**
 * Parse the two public build-time values. A missing token, or a host that is
 * not an https origin, yields `null` (analytics disabled) rather than an error,
 * so a bad value can never break a build or a page.
 */
export function resolveAnalyticsConfig(raw: {
  token?: string | undefined;
  host?: string | undefined;
}): AnalyticsConfig | null {
  const token = raw.token?.trim();
  if (!token || !/^phc_[A-Za-z0-9]{20,}$/.test(token)) return null;
  const host = raw.host?.trim() || DEFAULT_POSTHOG_HOST;
  try {
    const url = new URL(host);
    if (url.protocol !== "https:") return null;
    return { token, apiHost: url.origin };
  } catch {
    return null;
  }
}

/**
 * The deployment config. Next inlines each `process.env.NEXT_PUBLIC_*` literal
 * at build time into both the browser and server bundles, so these two names
 * must be referenced literally (never through a dynamic key).
 */
export const analyticsConfig: AnalyticsConfig | null = resolveAnalyticsConfig({
  token: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
});

/**
 * Exact production-host match. Accepts a bare hostname (`location.hostname`) or
 * a `Host` header value with an optional port, and nothing else: no
 * subdomains, no suffix matching, no userinfo.
 */
export function isAnalyticsHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const match = /^([a-z0-9.-]+)(?::\d{1,5})?$/i.exec(host.trim());
  if (!match) return false;
  return match[1]!.toLowerCase().replace(/\.$/, "") === ANALYTICS_PRODUCTION_HOSTNAME;
}

/** Whether a `Cookie` header carries the opt-out flag. */
export function hasOptOutCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((part) => part.trim() === `${ANALYTICS_OPT_OUT_COOKIE}=1`);
}

/** Global Privacy Control / Do Not Track, as sent by browsers. */
export function hasPrivacySignal(signals: {
  globalPrivacyControl?: boolean | string | null | undefined;
  doNotTrack?: string | null | undefined;
}): boolean {
  const gpc = signals.globalPrivacyControl;
  if (gpc === true || gpc === "1") return true;
  const dnt = signals.doNotTrack;
  return dnt === "1" || dnt === "yes";
}
