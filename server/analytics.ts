import {
  analyticsConfig,
  consentAllows,
  hasPrivacySignal,
  hasSignalCookie,
  environmentProperties,
  readAnalyticsChoice,
  resolveAnalyticsEnvironment,
  type AnalyticsConfig,
  type AnalyticsEnvironment,
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
 * and applies the same gates as the browser (production host or an explicitly
 * enabled preview host, configured token, the visitor's consent choice, Global
 * Privacy Control, Do Not Track). Like every browser event it carries the
 * `environment` (and `preview_pr`) of the host it came from.
 * The distinct ID is the stable Better Auth user ID, so the event belongs to
 * the same PostHog person the browser identifies. There is no `posthog-node`
 * dependency: one POST to the public capture endpoint is all that is needed.
 */

const CAPTURE_TIMEOUT_MS = 2_000;

type FetchLike = (input: string, init: RequestInit) => Promise<unknown>;

/**
 * The analytics environment of this request if it may produce a server-side
 * event, otherwise `null`. Decided from the request's own host alone.
 */
export function serverAnalyticsEnvironment(
  requestHeaders: Headers,
  config: AnalyticsConfig | null = analyticsConfig,
): AnalyticsEnvironment | null {
  if (!config) return null;
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const environment = resolveAnalyticsEnvironment(host, config.previewPrs);
  if (!environment) return null;
  const cookies = requestHeaders.get("cookie");
  // The explicit choice: under the shipped consent model "yes" is required.
  if (!consentAllows(readAnalyticsChoice(cookies))) return null;
  // A privacy signal wins over a stored "yes". The browser also mirrors its
  // signal into a cookie, so it is honored even if the headers never arrive.
  if (hasSignalCookie(cookies)) return null;
  const signalled = hasPrivacySignal({
    globalPrivacyControl: requestHeaders.get("sec-gpc"),
    doNotTrack: requestHeaders.get("dnt"),
  });
  return signalled ? null : environment;
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
    const environment = serverAnalyticsEnvironment(requestHeaders, config);
    if (!config || !environment) return;
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
            ...environmentProperties(environment),
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
