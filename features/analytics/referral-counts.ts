import {
  ANALYTICS_PRODUCTION_HOSTNAME,
  hasPrivacySignal,
  hasSignalCookie,
  isRuneSpaceHostname,
} from "./analytics-policy";
import { analyticsRouteTemplate, sanitizeUtmValue, type RouteCategory } from "./analytics-events";

/**
 * Aggregate referral counting rules (issue #425). Pure: no database, no
 * request object, no environment, so the middleware, the persistence layer and
 * the tests all share one definition of what is counted and what is stored.
 *
 * This is deliberately NOT visitor analytics. It decides whether one public
 * page load increments a daily total, and which sanitized labels that total is
 * filed under. The request's address, User-Agent, Referer and URL are read to
 * make that decision and are never stored; only the labels below are.
 */

/** Visitor-requested objection to the aggregate visit counts. Independent of PostHog. */
export const STATS_OPTOUT_COOKIE = "rs_stats_optout";
export const STATS_OPTOUT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
/** Fired on `window` when the visitor changes the visit-count objection. */
export const STATS_OPTOUT_EVENT = "runespace:stats-optout";

/** Where the objection control lives (Safety & Privacy anchor). */
export const VISIT_COUNT_SETTINGS_ID = "visit-count-settings";

/** Months of aggregated rows kept. Older rows are deleted by `pruneReferralCounts`. */
export const REFERRAL_RETENTION_MONTHS = 25;

/**
 * At most this many distinct non-empty (utm_source, utm_medium, utm_campaign)
 * label sets are filed per process per UTC day. Past it, new label sets are
 * collapsed into `OVERFLOW_LABEL`, so a link crafted with endless campaign
 * values cannot grow the table without bound.
 */
export const MAX_UTM_COMBINATIONS_PER_DAY = 100;
export const OVERFLOW_LABEL = "(other)";

/** Source groups that exist besides the named sites below. */
export type SourceGroup =
  | "direct_unknown"
  | "internal"
  | "other"
  | (typeof NAMED_SOURCE_GROUPS)[number]["group"];

/**
 * Named outreach sources. Matching is by referring hostname (the host itself or
 * a subdomain of one of `domains`) and, when a referrer is stripped (in-app
 * browsers, privacy settings), by a `utm_source` of the same name. The list is
 * the allowlist: anything else is `other`, never a new row per site.
 */
const NAMED_SOURCE_GROUPS = [
  { group: "linkedin", domains: ["linkedin.com", "lnkd.in"] },
  { group: "reddit", domains: ["reddit.com", "redd.it"] },
  { group: "discord", domains: ["discord.com", "discord.gg", "discordapp.com"] },
  { group: "google", domains: [] },
  { group: "bing", domains: ["bing.com"] },
  { group: "duckduckgo", domains: ["duckduckgo.com"] },
  { group: "youtube", domains: ["youtube.com", "youtu.be"] },
  { group: "x", domains: ["x.com", "twitter.com", "t.co"] },
  { group: "facebook", domains: ["facebook.com", "fb.com", "fb.me"] },
  { group: "bluesky", domains: ["bsky.app"] },
  { group: "github", domains: ["github.com"] },
  { group: "hacker_news", domains: ["news.ycombinator.com"] },
  { group: "qcfailed", domains: ["qcfailed.com"] },
] as const;

const GOOGLE_HOST = /^(?:[a-z0-9-]+\.)*google\.(?:com?\.[a-z]{2}|com|[a-z]{2})$/;

function domainGroup(hostname: string): SourceGroup | undefined {
  if (GOOGLE_HOST.test(hostname)) return "google";
  for (const { group, domains } of NAMED_SOURCE_GROUPS) {
    if (domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return group;
    }
  }
  return undefined;
}

function utmSourceGroup(utmSource: string | undefined): SourceGroup | undefined {
  if (!utmSource) return undefined;
  const key = utmSource.replace(/[^a-z0-9]/g, "");
  for (const { group } of NAMED_SOURCE_GROUPS) {
    if (key === group.replace(/_/g, "")) return group;
  }
  if (key === "twitter") return "x";
  if (key === "hn" || key === "hackernews") return "hacker_news";
  return undefined;
}

function refererHostname(referer: string | null | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    const url = new URL(referer);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.hostname.toLowerCase().replace(/\.$/, "") || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The source group of a page load. A recognised referring site wins; with no
 * usable referrer (or only the site's own), a recognised `utm_source` stands in
 * for it. Navigation from RuneSpace's own pages is `internal`, a referrer or
 * `utm_source` that is not on the allowlist is `other`, and a visit with
 * neither is honestly `direct_unknown`.
 */
export function classifySourceGroup(
  referer: string | null | undefined,
  utmSource: string | undefined,
): SourceGroup {
  const hostname = refererHostname(referer);
  if (hostname && !isRuneSpaceHostname(hostname)) {
    return domainGroup(hostname) ?? utmSourceGroup(utmSource) ?? "other";
  }
  const fromUtm = utmSourceGroup(utmSource);
  if (fromUtm) return fromUtm;
  if (hostname) return "internal";
  return utmSource ? "other" : "direct_unknown";
}

/** The route categories that may be counted: public pages only. */
const COUNTED_CATEGORIES: ReadonlySet<RouteCategory> = new Set([
  "landing",
  "updates",
  "wiki",
  "high-scores",
  "auth",
]);

/**
 * The route category a pathname is filed under, or `null` when it must not be
 * counted: Play, Characters, operator/internal/API surfaces, and any path that
 * is not a known public route. Only the category is ever kept, never the path.
 */
export function countedRouteCategory(pathname: string): RouteCategory | null {
  const template = analyticsRouteTemplate(pathname);
  return template && COUNTED_CATEGORIES.has(template.category) ? template.category : null;
}

/**
 * Whether this request's host may be counted: the production public host and
 * nothing else. Previews, localhost, CI and every other host are never counted,
 * whatever the build config. Uses the same forwarded-host precedence as the
 * server analytics reporter. `extraHostname` exists only for the repository's
 * own local E2E runtime (see `middleware.ts`), which previews and production
 * can never satisfy, so a browser test can exercise the real counter.
 */
export function isCountingHost(
  headers: { get(name: string): string | null },
  extraHostname?: string,
): boolean {
  const raw = headers.get("x-forwarded-host") ?? headers.get("host");
  const match = raw ? /^([a-z0-9.-]+)(?::\d{1,5})?$/i.exec(raw.trim()) : null;
  const hostname = match?.[1]?.toLowerCase().replace(/\.$/, "");
  return (
    hostname === ANALYTICS_PRODUCTION_HOSTNAME || (!!extraHostname && hostname === extraHostname)
  );
}

/** Whether a `Cookie` header carries the visitor's visit-count objection. */
export function hasStatsOptOut(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((part) => part.trim() === `${STATS_OPTOUT_COOKIE}=1`);
}

/**
 * The `Set-Cookie` / `document.cookie` value that records (`counting: false`)
 * or clears (`counting: true`) the objection. The one function builds it for
 * the no-JS POST route and for the in-page control, so they cannot drift.
 */
export function statsOptOutCookie(counting: boolean, secure: boolean): string {
  const lifetime = counting ? "Max-Age=0" : `Max-Age=${STATS_OPTOUT_MAX_AGE_SECONDS}`;
  return `${STATS_OPTOUT_COOKIE}=${counting ? "" : "1"}; ${lifetime}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** User-Agent substrings of crawlers, link previewers, and automation. Best effort. */
const AUTOMATED_AGENT =
  /bot|crawl|spider|slurp|preview|fetch|scan|monitor|probe|headless|lighthouse|python|curl|wget|httpclient|okhttp|go-http|axios|node-fetch|java\/|facebookexternalhit|embedly|discordbot|linkedinbot|whatsapp|telegram|skype|pingdom|uptime|gtmetrix|archive/i;

export function looksAutomated(userAgent: string | null | undefined): boolean {
  return !userAgent || AUTOMATED_AGENT.test(userAgent);
}

export type CountableRequest = {
  method: string;
  /** Pathname only (no query). */
  pathname: string;
  /** The raw query string, with or without the leading `?`. */
  search: string;
  headers: { get(name: string): string | null };
};

export type ReferralCountLabels = {
  sourceGroup: SourceGroup;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  routeCategory: RouteCategory;
};

/**
 * Decide whether a request is one public HTML document navigation that should
 * increment today's total, and under which sanitized labels. Returns `null`
 * for everything else. Every exclusion is best effort and errs toward not
 * counting:
 *
 * - only `GET` on the production host;
 * - only browser top-level document navigations, recognised by Fetch Metadata
 *   (`Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`). Browsers that do
 *   not send it, and most scripts, are therefore undercounted by design;
 * - not a browser prefetch/prerender (`Purpose` / `Sec-Purpose`). Next.js
 *   client navigations and `<Link>` prefetches are `fetch()` calls
 *   (`Sec-Fetch-Dest: empty`), so the Fetch Metadata rule above already excludes
 *   them. Next removes its own RSC and prefetch markers from the request before
 *   middleware runs (verified on 15.5.20), so they cannot be relied on here;
 * - not an obvious crawler, link previewer, or automation (User-Agent is read,
 *   never stored);
 * - not a visitor who sent `Sec-GPC: 1` or `DNT: 1`, carries the
 *   `rs_stats_optout` cookie, or the browser's privacy-signal mirror cookie.
 */
export function referralCountLabels(
  request: CountableRequest,
  options: { extraHostname?: string } = {},
): ReferralCountLabels | null {
  const { headers } = request;
  if (request.method !== "GET") return null;
  if (!isCountingHost(headers, options.extraHostname)) return null;

  if (headers.get("sec-fetch-mode") !== "navigate") return null;
  if (headers.get("sec-fetch-dest") !== "document") return null;
  if (!(headers.get("accept") ?? "").includes("text/html")) return null;
  // Browser speculative loads (prefetch/prerender) are not visits.
  if (
    /prefetch|prerender/i.test(headers.get("purpose") ?? "") ||
    /prefetch|prerender/i.test(headers.get("sec-purpose") ?? "")
  ) {
    return null;
  }

  const cookies = headers.get("cookie");
  if (hasStatsOptOut(cookies) || hasSignalCookie(cookies)) return null;
  if (
    hasPrivacySignal({
      globalPrivacyControl: headers.get("sec-gpc"),
      doNotTrack: headers.get("dnt"),
    })
  ) {
    return null;
  }
  if (looksAutomated(headers.get("user-agent"))) return null;

  const routeCategory = countedRouteCategory(request.pathname);
  if (!routeCategory) return null;

  const params = new URLSearchParams(request.search);
  const utmSource = sanitizeUtmValue(params.get("utm_source")) ?? "";
  const utmMedium = sanitizeUtmValue(params.get("utm_medium")) ?? "";
  const utmCampaign = sanitizeUtmValue(params.get("utm_campaign")) ?? "";

  return {
    sourceGroup: classifySourceGroup(headers.get("referer"), utmSource || undefined),
    utmSource,
    utmMedium,
    utmCampaign,
    routeCategory,
  };
}

/** The UTC calendar day (`YYYY-MM-DD`) a count belongs to. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
