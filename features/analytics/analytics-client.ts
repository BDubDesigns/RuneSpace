import type { PostHog } from "posthog-js";
import {
  ANALYTICS_CHOICE_EVENT,
  ANALYTICS_OPT_OUT_COOKIE,
  ANALYTICS_OPT_OUT_MAX_AGE_SECONDS,
  analyticsConfig,
  hasOptOutCookie,
  hasPrivacySignal,
  isAnalyticsHost,
} from "./analytics-policy";
import {
  analyticsRouteTemplate,
  eventProperties,
  firstTouchProperties,
  parseLandingAttribution,
  sanitizeCapture,
  type AnalyticsEventName,
  type AnalyticsEventProperties,
} from "./analytics-events";

/**
 * Browser-side PostHog wrapper (issue #413). Every public function is a safe
 * no-op unless `analyticsPermitted()` holds, and none ever throws: analytics
 * can fail or be blocked without affecting the game. `posthog-js` is imported
 * lazily, so localhost, CI and previews never even download it.
 *
 * The SDK is configured so that nothing is captured automatically: no
 * autocapture, pageviews, pageleaves, heatmaps, dead clicks, exceptions,
 * performance, session replay, surveys or remote config. Every event is
 * explicit, and `sanitizeCapture` rebuilds each payload from an allowlist.
 */

export type AnalyticsPermission =
  | "permitted"
  | "unconfigured"
  | "wrong-host"
  | "privacy-signal"
  | "opted-out";

/** Why analytics is or is not running for this page load. */
export function analyticsStatus(): AnalyticsPermission {
  if (typeof window === "undefined" || !analyticsConfig) return "unconfigured";
  if (!isAnalyticsHost(window.location.hostname)) return "wrong-host";
  if (
    hasPrivacySignal({
      globalPrivacyControl: (navigator as Navigator & { globalPrivacyControl?: boolean })
        .globalPrivacyControl,
      doNotTrack: navigator.doNotTrack,
    })
  ) {
    return "privacy-signal";
  }
  if (hasOptOutCookie(document.cookie)) return "opted-out";
  return "permitted";
}

export function analyticsPermitted(): boolean {
  return analyticsStatus() === "permitted";
}

/** The visitor's saved choice, independent of host or browser signals. */
export function analyticsOptedOut(): boolean {
  return typeof document !== "undefined" && hasOptOutCookie(document.cookie);
}

export function setAnalyticsOptOut(optOut: boolean): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = optOut
      ? `${ANALYTICS_OPT_OUT_COOKIE}=1; Max-Age=${ANALYTICS_OPT_OUT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`
      : `${ANALYTICS_OPT_OUT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
    if (optOut) stopAnalytics();
    window.dispatchEvent(new Event(ANALYTICS_CHOICE_EVENT));
  } catch {
    /* a blocked cookie must not break the privacy page */
  }
}

// -- SDK lifecycle ------------------------------------------------------------

let loading: Promise<PostHog | null> | undefined;

/**
 * Load and initialise PostHog once. Resolves to `null` (and caches nothing
 * that could re-enable it) when analytics is not permitted or loading fails.
 */
export function startAnalytics(): Promise<PostHog | null> {
  if (!analyticsPermitted() || !analyticsConfig) return Promise.resolve(null);
  const config = analyticsConfig;
  loading ??= import("posthog-js")
    .then(({ default: posthog }) => {
      // After an opt-out and opt back in the singleton is already initialised.
      if (posthog.__loaded) {
        if (posthog.has_opted_out_capturing())
          posthog.opt_in_capturing({ captureEventName: false });
        return posthog;
      }
      posthog.init(config.token, {
        api_host: config.apiHost,
        // Nothing is captured unless RuneSpace asks for it by name.
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_performance: false,
        rageclick: false,
        disable_session_recording: true,
        disable_surveys: true,
        disable_product_tours: true,
        disable_conversations: true,
        disable_web_experiments: true,
        disable_external_dependency_loading: true,
        // Remote config could re-enable the features above from the dashboard.
        advanced_disable_flags: true,
        // Anonymous visitors get no person profile until they sign in.
        person_profiles: "identified_only",
        persistence: "localStorage",
        respect_dnt: true,
        save_referrer: false,
        mask_personal_data_properties: true,
        before_send: (capture) => sanitizeCapture(capture),
      });
      return posthog;
    })
    .catch(() => null);
  return loading;
}

/** Stop capturing and forget this browser's analytics identity. */
export function stopAnalytics(): void {
  const pending = loading;
  loading = undefined;
  void pending
    ?.then((posthog) => {
      posthog?.opt_out_capturing();
      posthog?.reset();
    })
    .catch(() => undefined);
}

function withClient(run: (posthog: PostHog) => void): void {
  if (!analyticsPermitted()) return;
  void startAnalytics()
    .then((posthog) => {
      if (posthog) run(posthog);
    })
    .catch(() => undefined);
}

// -- Events -------------------------------------------------------------------

/** Record one declared lifecycle event. Call only after a confirmed success. */
export function trackAnalyticsEvent<E extends AnalyticsEventName>(
  event: E,
  properties?: AnalyticsEventProperties[E],
): void {
  withClient((posthog) => posthog.capture(event, eventProperties(event, properties)));
}

let attributionRegistered = false;

/**
 * Record a sanitized pageview. The first one in a page load also carries the
 * landing attribution (allowlisted UTM trio plus referring domain) and
 * registers first-touch copies once per browser.
 */
export function trackAnalyticsPageview(pathname: string, landing: boolean): void {
  const template = analyticsRouteTemplate(pathname);
  if (!template) return;
  withClient((posthog) => {
    const properties: Record<string, string> = { route_category: template.category };
    if (landing) {
      const attribution = parseLandingAttribution(window.location.search, document.referrer);
      Object.assign(properties, attribution);
      if (!attributionRegistered) {
        attributionRegistered = true;
        posthog.register_once(firstTouchProperties(attribution));
      }
    }
    posthog.capture("$pageview", properties);
  });
}

// -- Identity -----------------------------------------------------------------

/** Link this browser to the stable Better Auth user ID. No person properties. */
export function identifyAnalyticsAccount(userId: string): void {
  withClient((posthog) => {
    if (posthog.get_distinct_id() !== userId) posthog.identify(userId);
  });
}

/** After sign-out (or a vanished session): drop the identity if one was set. */
export function resetAnalyticsIdentity(): void {
  withClient((posthog) => {
    if (posthog.get_property("$user_state") === "identified") posthog.reset();
  });
}
