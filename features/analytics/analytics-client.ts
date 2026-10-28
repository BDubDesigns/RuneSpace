import type { PostHog } from "posthog-js";
import {
  ANALYTICS_CHOICE_COOKIE,
  ANALYTICS_CHOICE_EVENT,
  ANALYTICS_CHOICE_MAX_AGE_SECONDS,
  ANALYTICS_SIGNAL_COOKIE,
  analyticsConfig,
  consentAllows,
  hasPrivacySignal,
  readAnalyticsChoice,
  resolveAnalyticsEnvironment,
  type AnalyticsChoice,
  type AnalyticsEnvironment,
} from "./analytics-policy";
import {
  analyticsRouteTemplate,
  eventProperties,
  firstTouchProperties,
  parseLandingAttribution,
  sanitizeCapture,
  type AnalyticsEventName,
  type AnalyticsEventProperties,
  type LandingAttribution,
} from "./analytics-events";

/**
 * Browser-side PostHog wrapper (issue #413). Every public function is a safe
 * no-op unless `analyticsPermitted()` holds, and none ever throws: analytics
 * can fail or be blocked without affecting the game. `posthog-js` is imported
 * lazily, so localhost, CI, previews, and (under the shipped opt-in model)
 * visitors who have not said yes never even download it, and nothing is
 * written to their storage.
 *
 * Permission is re-read, not remembered: after the SDK import resolves and
 * immediately before every queued event or identity action, so a choice made
 * while the SDK is loading (or while an action waits on it) is honored.
 *
 * The SDK is configured so that nothing is captured automatically: no
 * autocapture, pageviews, pageleaves, heatmaps, dead clicks, exceptions,
 * performance, session replay, surveys or remote config. Every event is
 * explicit, and `sanitizeCapture` rebuilds each payload from an allowlist.
 *
 * Landing attribution is the one thing read before a visitor has chosen, and
 * only into memory (see `syncLandingAttribution`).
 */

export type AnalyticsPermission =
  | "permitted"
  | "unconfigured"
  | "wrong-host"
  | "privacy-signal"
  | "needs-consent"
  | "declined";

type PrivacyNavigator = Navigator & {
  globalPrivacyControl?: boolean;
  msDoNotTrack?: string;
};

/** Global Privacy Control / Do Not Track as the browser exposes them to scripts. */
export function browserPrivacySignal(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as PrivacyNavigator;
  const win = typeof window === "undefined" ? undefined : (window as { doNotTrack?: string });
  return (
    hasPrivacySignal({
      globalPrivacyControl: nav.globalPrivacyControl,
      doNotTrack: nav.doNotTrack,
    }) ||
    hasPrivacySignal({ doNotTrack: nav.msDoNotTrack }) ||
    hasPrivacySignal({ doNotTrack: win?.doNotTrack })
  );
}

/** The visitor's saved choice, independent of host or browser signals. */
export function analyticsChoice(): AnalyticsChoice | undefined {
  return typeof document === "undefined" ? undefined : readAnalyticsChoice(document.cookie);
}

/**
 * Which deployment this page is (production, or an explicitly enabled preview),
 * or `null` anywhere analytics may not run (localhost, tests, unlisted previews,
 * any other host). Read from the live hostname every time, never cached.
 */
export function currentAnalyticsEnvironment(): AnalyticsEnvironment | null {
  if (typeof window === "undefined" || !analyticsConfig) return null;
  return resolveAnalyticsEnvironment(window.location.hostname, analyticsConfig.previewPrs);
}

/** Why analytics is or is not running for this page load. */
export function analyticsStatus(): AnalyticsPermission {
  if (typeof window === "undefined" || !analyticsConfig) return "unconfigured";
  if (!currentAnalyticsEnvironment()) return "wrong-host";
  if (browserPrivacySignal()) return "privacy-signal";
  if (consentAllows(analyticsChoice())) return "permitted";
  return analyticsChoice() === "off" ? "declined" : "needs-consent";
}

export function analyticsPermitted(): boolean {
  return analyticsStatus() === "permitted";
}

function cookieAttributes(maxAge?: number): string {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  return `${maxAge === undefined ? "" : `; Max-Age=${maxAge}`}; Path=/; SameSite=Lax${secure}`;
}

/** Record the visitor's explicit choice. Turning analytics off stops it at once. */
export function setAnalyticsChoice(choice: AnalyticsChoice): void {
  try {
    document.cookie = `${ANALYTICS_CHOICE_COOKIE}=${choice}${cookieAttributes(ANALYTICS_CHOICE_MAX_AGE_SECONDS)}`;
    if (choice === "off") stopAnalytics();
    window.dispatchEvent(new Event(ANALYTICS_CHOICE_EVENT));
  } catch {
    /* a blocked cookie must not break the privacy page */
  }
}

/**
 * Keep the session signal cookie in step with the browser's privacy signal, so
 * the server-side reporter sees it even if the headers never arrive. Only runs
 * where analytics could run at all (configured token, production host).
 */
export function syncPrivacySignalCookie(): void {
  try {
    if (!currentAnalyticsEnvironment()) return;
    document.cookie = browserPrivacySignal()
      ? `${ANALYTICS_SIGNAL_COOKIE}=1${cookieAttributes()}`
      : `${ANALYTICS_SIGNAL_COOKIE}=; Max-Age=0${cookieAttributes()}`;
  } catch {
    /* best effort */
  }
}

// -- SDK lifecycle ------------------------------------------------------------

let loading: Promise<PostHog | null> | undefined;

/**
 * Load and initialise PostHog once. Resolves to `null` when analytics is not
 * permitted, when permission is withdrawn while the SDK is loading, or when
 * loading fails; a null outcome is never cached, so a later grant can start.
 */
export function startAnalytics(): Promise<PostHog | null> {
  if (!analyticsPermitted() || !analyticsConfig) return Promise.resolve(null);
  const config = analyticsConfig;
  if (loading) return loading;
  const attempt: Promise<PostHog | null> = import("posthog-js")
    .then(({ default: posthog }) => {
      // The visitor may have declined, or a privacy signal may have appeared,
      // while the SDK downloaded: nothing may initialise or resume then.
      if (!analyticsPermitted()) {
        if (posthog.__loaded) posthog.opt_out_capturing();
        return null;
      }
      // After an opt-out and opt back in the singleton is already initialised.
      if (posthog.__loaded) {
        if (posthog.has_opted_out_capturing()) {
          posthog.opt_in_capturing({ captureEventName: false });
        }
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
        // Last gate before an event is built: permission can change between
        // the action that asked for it and the SDK handling it. The
        // environment is read from the live host and stamped on every event.
        before_send: (capture) => {
          const env = currentAnalyticsEnvironment();
          return env && analyticsPermitted() ? sanitizeCapture(capture, env) : null;
        },
      });
      return posthog;
    })
    .catch(() => null)
    .then((posthog) => {
      if (!posthog && loading === attempt) loading = undefined;
      return posthog;
    });
  loading = attempt;
  return attempt;
}

/** Stop capturing and forget this browser's analytics identity and any held attribution. */
export function stopAnalytics(): void {
  landingAttribution = undefined;
  const pending = loading;
  loading = undefined;
  void pending
    ?.then((posthog) => {
      // A grant that arrived in the meantime has already restarted analytics.
      if (!posthog || analyticsPermitted()) return;
      posthog.opt_out_capturing();
      posthog.reset();
    })
    .catch(() => undefined);
}

function withClient(run: (posthog: PostHog) => void): void {
  if (!analyticsPermitted()) return;
  void startAnalytics()
    .then((posthog) => {
      // Re-check: the choice may have changed while the SDK loaded.
      if (posthog && analyticsPermitted()) run(posthog);
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

// -- Landing attribution ------------------------------------------------------

/**
 * The page load's sanitized landing attribution, held only in this variable
 * while the visitor has not yet chosen. It is never written to storage or a
 * cookie, never sent, and not rebuilt: a hard page load starts empty.
 */
let landingAttribution: LandingAttribution | undefined;
let landingObserved = false;

/**
 * Called by the provider on mount and on every change of the visitor's choice.
 * The first call of a page load, if analytics could run here and the visitor
 * has neither declined nor sent a privacy signal, reduces the landing URL and
 * referrer to the allowlisted UTM trio plus a referring domain and holds that
 * until the first permitted pageview uses it. The page load is observed only
 * once, so a later call never reads a later (SPA-navigated) URL. A refusal or
 * privacy signal discards what is held, and it is not read again that page
 * load: saying yes afterwards starts without it.
 */
export function syncLandingAttribution(): void {
  try {
    const status = analyticsStatus();
    if (status !== "needs-consent" && status !== "permitted") {
      landingAttribution = undefined;
      landingObserved = true;
      return;
    }
    if (landingObserved) return;
    landingObserved = true;
    landingAttribution = parseLandingAttribution(window.location.search, document.referrer);
  } catch {
    landingAttribution = undefined;
  }
}

/** Hand over the held attribution exactly once. */
function takeLandingAttribution(): LandingAttribution | undefined {
  const attribution = landingAttribution;
  landingAttribution = undefined;
  return attribution;
}

// -- Pageviews ----------------------------------------------------------------

/**
 * Record a sanitized pageview. The first permitted one of a page load (the
 * runtime's first, `landing`) also carries the held landing attribution, which
 * may predate the route it is sent from if the visitor accepted after
 * navigating, and registers first-touch copies once per browser.
 */
export function trackAnalyticsPageview(pathname: string, landing: boolean): void {
  const template = analyticsRouteTemplate(pathname);
  if (!template) return;
  withClient((posthog) => {
    const properties: Record<string, string> = { route_category: template.category };
    const attribution = landing ? takeLandingAttribution() : undefined;
    if (attribution) {
      Object.assign(properties, attribution);
      posthog.register_once(firstTouchProperties(attribution));
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
