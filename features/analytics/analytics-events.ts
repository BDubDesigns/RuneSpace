import {
  environmentProperties,
  isRuneSpaceHostname,
  type AnalyticsEnvironment,
} from "./analytics-policy";

/**
 * The analytics event contract and every sanitizer that stands between the
 * game and PostHog (issue #413). Pure: no SDK, no DOM, no environment. The
 * browser wrapper and the server reporter both build their payloads from here,
 * so an event name or property that is not declared below cannot be sent.
 */

/** The narrow first-slice lifecycle events. `$pageview` is separate. */
export const ANALYTICS_EVENTS = {
  accountRegistrationSucceeded: "account_registration_succeeded",
  characterCreationSucceeded: "character_creation_succeeded",
  gameplayEntered: "gameplay_entered",
  gameplayMilestoneReached: "gameplay_milestone_reached",
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/**
 * The one early milestone (issue #413): a Play session observed a character's
 * total skill XP go from zero to positive in server-confirmed state. See
 * `observeFirstXpGain`.
 */
export const FIRST_XP_GAINED_MILESTONE = "first_xp_gained";

/** Allowlisted custom properties per event. Most events carry none. */
export type AnalyticsEventProperties = {
  account_registration_succeeded: Record<string, never>;
  character_creation_succeeded: Record<string, never>;
  gameplay_entered: Record<string, never>;
  gameplay_milestone_reached: { milestone: typeof FIRST_XP_GAINED_MILESTONE };
};

const EVENT_PROPERTY_KEYS: Record<AnalyticsEventName, readonly string[]> = {
  account_registration_succeeded: [],
  character_creation_succeeded: [],
  gameplay_entered: [],
  gameplay_milestone_reached: ["milestone"],
};

// -- Routes -------------------------------------------------------------------

export type RouteCategory =
  | "landing"
  | "updates"
  | "wiki"
  | "high-scores"
  | "auth"
  | "characters"
  | "play"
  | "other";

export type RouteTemplate = { path: string; category: RouteCategory };

/** Routes that must never produce an analytics pageview. */
const UNTRACKED_PREFIXES = [
  "/admin",
  "/moderation",
  "/qc-studio",
  "/design-system",
  "/api",
  "/_next",
] as const;

/**
 * Collapse a pathname to its route template. Dynamic segments become
 * placeholders, so no character ID, Player name, sanction ID, or article slug
 * is ever reported. Returns `null` for operator/internal surfaces, which are
 * not tracked at all. Query strings and fragments are never read here.
 */
export function analyticsRouteTemplate(pathname: string): RouteTemplate | null {
  const path = pathname.split(/[?#]/)[0] ?? "";
  const segments = path.split("/").filter(Boolean);
  const first = segments[0];
  if (first === undefined) return { path: "/", category: "landing" };
  if (UNTRACKED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return null;
  }
  const count = segments.length;
  switch (first) {
    case "updates":
      if (count === 1) return { path: "/updates", category: "updates" };
      if (count === 2) return { path: "/updates/[slug]", category: "updates" };
      break;
    case "wiki":
      if (count === 1) return { path: "/wiki", category: "wiki" };
      if (segments[1] === "items") {
        return count === 2
          ? { path: "/wiki/items", category: "wiki" }
          : { path: "/wiki/items/[slug]", category: "wiki" };
      }
      return { path: "/wiki/[slug]", category: "wiki" };
    case "high-scores":
      if (count === 1) return { path: "/high-scores", category: "high-scores" };
      if (segments[1] === "characters" && count === 3) {
        return { path: "/high-scores/characters/[name]", category: "high-scores" };
      }
      break;
    case "register":
      if (count === 1) return { path: "/register", category: "auth" };
      break;
    case "sign-in":
      if (count === 1) return { path: "/sign-in", category: "auth" };
      break;
    case "characters":
      if (count === 1) return { path: "/characters", category: "characters" };
      if (count === 2 && segments[1] === "new") {
        return { path: "/characters/new", category: "characters" };
      }
      break;
    case "play":
      if (count === 2) return { path: "/play/[characterId]", category: "play" };
      break;
  }
  return { path: "/other", category: "other" };
}

// -- Attribution --------------------------------------------------------------

/** Reported when a visit has no referring site (direct, or a stripped referrer). */
export const DIRECT_OR_UNKNOWN_REFERRER = "direct_or_unknown";

export type LandingAttribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referring_domain: string;
};

const UTM_VALUE = /^[a-z0-9][a-z0-9 _.-]{0,63}$/;

/**
 * Bounded campaign label: lower-cased, at most 64 characters of letters,
 * digits, space, `_`, `.`, `-`. Anything else (an email address, a token, a
 * long string) is dropped whole rather than partially reported.
 */
export function sanitizeUtmValue(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && UTM_VALUE.test(normalized) ? normalized : undefined;
}

/** A referrer reduced to its lower-cased domain, or `undefined`. */
export function referrerDomain(referrer: string | null | undefined): string | undefined {
  if (!referrer) return undefined;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    // Navigation between RuneSpace's own deployments is not a referral.
    if (!hostname || isRuneSpaceHostname(hostname)) return undefined;
    return hostname;
  } catch {
    return undefined;
  }
}

/**
 * Landing attribution for the first pageview of a page load: the allowlisted
 * UTM trio from the query string plus the referring domain. Nothing else in the
 * query string is read.
 */
export function parseLandingAttribution(
  search: string,
  referrer: string | null | undefined,
): LandingAttribution {
  const params = new URLSearchParams(search);
  const attribution: LandingAttribution = {
    referring_domain: referrerDomain(referrer) ?? DIRECT_OR_UNKNOWN_REFERRER,
  };
  const source = sanitizeUtmValue(params.get("utm_source"));
  const medium = sanitizeUtmValue(params.get("utm_medium"));
  const campaign = sanitizeUtmValue(params.get("utm_campaign"));
  if (source) attribution.utm_source = source;
  if (medium) attribution.utm_medium = medium;
  if (campaign) attribution.utm_campaign = campaign;
  return attribution;
}

/** First-touch copies of the attribution, registered once per browser. */
export function firstTouchProperties(attribution: LandingAttribution): Record<string, string> {
  const properties: Record<string, string> = {
    first_touch_referring_domain: attribution.referring_domain,
  };
  if (attribution.utm_source) properties.first_touch_utm_source = attribution.utm_source;
  if (attribution.utm_medium) properties.first_touch_utm_medium = attribution.utm_medium;
  if (attribution.utm_campaign) properties.first_touch_utm_campaign = attribution.utm_campaign;
  return properties;
}

// -- Event payload sanitizing -------------------------------------------------

/**
 * Events the SDK is allowed to emit. `$identify` carries only the anonymous ID
 * being merged into the account. Everything else (autocapture, pageleave, web
 * vitals, exceptions, flag calls, surveys) is dropped.
 */
const ALLOWED_EVENTS: ReadonlySet<string> = new Set([
  ...Object.values(ANALYTICS_EVENTS),
  "$pageview",
  "$identify",
]);

/** SDK-generated properties known to be free of URLs and personal data. */
const SAFE_SDK_PROPERTIES: ReadonlySet<string> = new Set([
  "token",
  "distinct_id",
  "$anon_distinct_id",
  "$device_id",
  "$session_id",
  "$window_id",
  "$lib",
  "$lib_version",
  "$browser",
  "$browser_version",
  "$os",
  "$os_version",
  "$device_type",
  "$screen_height",
  "$screen_width",
  "$viewport_height",
  "$viewport_width",
  "$timezone",
  "$time",
  "$insert_id",
  "$pageview_id",
  "$is_identified",
  "$process_person_profile",
  "$sent_at",
]);

/** Properties RuneSpace itself registers or attaches to pageviews. */
const SAFE_APP_PROPERTIES: ReadonlySet<string> = new Set([
  "route_category",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "referring_domain",
  "first_touch_referring_domain",
  "first_touch_utm_source",
  "first_touch_utm_medium",
  "first_touch_utm_campaign",
]);

const UTM_KEYS: ReadonlySet<string> = new Set(["utm_source", "utm_medium", "utm_campaign"]);

const HOSTNAME = /^[a-z0-9.-]{1,253}$/;

export type CaptureLike = {
  event: string;
  properties: Record<string, unknown>;
  $set?: unknown;
  $set_once?: unknown;
  $unset?: unknown;
};

/**
 * The PostHog SDK `before_send` hook: returns the event rebuilt from an
 * allowlist, or `null` to drop it. The SDK stamps every event with the raw
 * `$current_url` (query string included), `$referrer`, `$pathname` and, in
 * `$set_once`, `$initial_*` person properties; none of those survive. The URL
 * fields are recomputed from the route template.
 */
export type SanitizedCapture<T extends CaptureLike> = Omit<T, "properties"> & {
  properties: Record<string, unknown>;
};

export function sanitizeCapture<T extends CaptureLike>(
  capture: T,
  env: AnalyticsEnvironment,
): SanitizedCapture<T> | null {
  if (!ALLOWED_EVENTS.has(capture.event)) return null;
  const source = capture.properties ?? {};
  const eventKeys =
    capture.event in EVENT_PROPERTY_KEYS
      ? EVENT_PROPERTY_KEYS[capture.event as AnalyticsEventName]
      : [];
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (UTM_KEYS.has(key)) {
      // The SDK also reads these from the raw URL (null when absent); only a
      // bounded label survives, never an arbitrary query-string value.
      const label = typeof value === "string" ? sanitizeUtmValue(value) : undefined;
      if (label) properties[key] = label;
    } else if (
      SAFE_SDK_PROPERTIES.has(key) ||
      SAFE_APP_PROPERTIES.has(key) ||
      eventKeys.includes(key)
    ) {
      properties[key] = value;
    }
  }

  const rawUrl = typeof source.$current_url === "string" ? source.$current_url : undefined;
  if (rawUrl !== undefined) {
    let template: RouteTemplate | null;
    try {
      template = analyticsRouteTemplate(new URL(rawUrl).pathname);
    } catch {
      template = { path: "/other", category: "other" };
    }
    // Operator/internal surfaces are not tracked, even for lifecycle events.
    if (template === null) return null;
    properties.$current_url = `https://${env.host}${template.path}`;
    properties.$pathname = template.path;
    properties.$host = env.host;
    if (capture.event === "$pageview") properties.route_category = template.category;
  }

  // Every event, whatever it is, states which deployment sent it. Computed from
  // the validated host, never read from the incoming properties.
  Object.assign(properties, environmentProperties(env));

  // The SDK runs with `save_referrer: false` (its native value is the raw
  // referrer URL), so it emits no `$referring_domain` of its own. The native
  // fields come from the sanitized landing attribution RuneSpace attaches to
  // the landing pageview, re-validated here; any other event has no referrer
  // to report and says `$direct`.
  const refDomain =
    referrerDomainProperty(source.referring_domain) ??
    referrerDomainProperty(source.$referring_domain);
  if (refDomain) {
    properties.$referring_domain = refDomain;
    // Native `$referrer` is a full URL; only the origin is ever known here.
    properties.$referrer = `https://${refDomain}`;
  } else {
    properties.$referring_domain = "$direct";
    properties.$referrer = "$direct";
  }

  const { $set: _set, $set_once: _setOnce, $unset: _unset, ...rest } = capture;
  void _set;
  void _setOnce;
  void _unset;
  return { ...rest, properties } as unknown as SanitizedCapture<T>;
}

function referrerDomainProperty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const domain = value.trim().toLowerCase();
  if (!HOSTNAME.test(domain) || isRuneSpaceHostname(domain)) return undefined;
  return domain;
}

/**
 * Validate the custom properties for one of the declared events: only keys
 * allowlisted for that event survive.
 */
export function eventProperties<E extends AnalyticsEventName>(
  event: E,
  properties?: AnalyticsEventProperties[E],
): Record<string, string> {
  const allowed = EVENT_PROPERTY_KEYS[event];
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (allowed.includes(key) && typeof value === "string") result[key] = value;
  }
  return result;
}

// -- Milestone ----------------------------------------------------------------

/** Total persisted XP across every skill in a server-confirmed Play state. */
export function totalSkillXp(skillTotalXp: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const value of Object.values(skillTotalXp)) {
    if (Number.isFinite(value) && value > 0) total += value;
  }
  return total;
}

/**
 * `first_xp_gained` fires only when two consecutive server-confirmed states
 * observed in one Play session show total XP going from exactly zero to
 * positive. A snapshot that is already positive when Play opens is never a
 * milestone, so existing characters get no fabricated retroactive event, and
 * ticks, panels and re-renders that leave XP unchanged cannot trigger it.
 */
export function observeFirstXpGain(previousTotal: number, nextTotal: number): boolean {
  return previousTotal === 0 && nextTotal > 0;
}
