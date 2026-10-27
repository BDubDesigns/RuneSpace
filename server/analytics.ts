import {
  analyticsConfig,
  hasOptOutCookie,
  hasPrivacySignal,
  isAnalyticsHost,
  type AnalyticsConfig,
} from "@/features/analytics/analytics-policy";
import { ANALYTICS_EVENTS } from "@/features/analytics/analytics-events";

/**
 * Best-effort server-side analytics (issue #413), for the one event that
 * happens inside a redirecting Server Action: `character_creation_succeeded`.
 * The action redirects as soon as the character is committed, so a browser
 * event could be lost with the navigation.
 *
 * This runs strictly AFTER the authoritative commit and can never change its
 * result: it is fire-and-forget with a short timeout, swallows every failure,
 * and applies the same gates as the browser (production host, configured
 * token, the visitor's opt-out cookie, Global Privacy Control, Do Not Track).
 * The distinct ID is the stable Better Auth user ID, so the event belongs to
 * the same PostHog person the browser identifies. There is no `posthog-node`
 * dependency: one POST to the public capture endpoint is all that is needed.
 */

const CAPTURE_TIMEOUT_MS = 2_000;

type FetchLike = (input: string, init: RequestInit) => Promise<unknown>;

/** Whether this request is allowed to produce a server-side analytics event. */
export function serverAnalyticsAllowed(
  requestHeaders: Headers,
  config: AnalyticsConfig | null = analyticsConfig,
): config is AnalyticsConfig {
  if (!config) return false;
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!isAnalyticsHost(host)) return false;
  if (hasOptOutCookie(requestHeaders.get("cookie"))) return false;
  return !hasPrivacySignal({
    globalPrivacyControl: requestHeaders.get("sec-gpc"),
    doNotTrack: requestHeaders.get("dnt"),
  });
}

/**
 * Report one committed character creation. Carries no character ID, name,
 * portrait, or request data: only the event name and the account's stable ID.
 */
export function reportCharacterCreationSucceeded(
  requestHeaders: Headers,
  userId: string,
  options: { config?: AnalyticsConfig | null; fetchImpl?: FetchLike } = {},
): void {
  try {
    const config = options.config === undefined ? analyticsConfig : options.config;
    if (!serverAnalyticsAllowed(requestHeaders, config)) return;
    const send = options.fetchImpl ?? (fetch as FetchLike);
    void Promise.resolve(
      send(`${config.apiHost}/i/v0/e/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: config.token,
          event: ANALYTICS_EVENTS.characterCreationSucceeded,
          distinct_id: userId,
          properties: {
            $lib: "runespace-server",
            // The server's own address is not the player's location.
            $geoip_disable: true,
          },
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
      }),
    ).catch(() => undefined);
  } catch {
    /* analytics must never affect a player action */
  }
}
