import { describe, expect, it } from "vitest";
import {
  ANALYTICS_EVENTS,
  DIRECT_OR_UNKNOWN_REFERRER,
  analyticsRouteTemplate,
  eventProperties,
  firstTouchProperties,
  observeFirstXpGain,
  parseLandingAttribution,
  referrerDomain,
  sanitizeCapture as sanitizeWith,
  sanitizeUtmValue,
  totalSkillXp,
} from "@/features/analytics/analytics-events";

const PRODUCTION = { environment: "production", host: "runespace.qcfailed.com" } as const;
const PREVIEW = {
  environment: "preview",
  host: "pr-414.runespace.qcfailed.com",
  pr: 414,
} as const;

/** Sanitize as the production host unless a test names another environment. */
function sanitizeCapture<T extends Parameters<typeof sanitizeWith>[0]>(
  capture: T,
  env: Parameters<typeof sanitizeWith>[1] = PRODUCTION,
) {
  return sanitizeWith(capture, env);
}

describe("route templates", () => {
  it.each([
    ["/", "/", "landing"],
    ["/updates", "/updates", "updates"],
    ["/updates/soft-alpha-opens", "/updates/[slug]", "updates"],
    ["/wiki", "/wiki", "wiki"],
    ["/wiki/safety-and-privacy", "/wiki/[slug]", "wiki"],
    ["/wiki/items", "/wiki/items", "wiki"],
    ["/wiki/items/power-cell", "/wiki/items/[slug]", "wiki"],
    ["/high-scores", "/high-scores", "high-scores"],
    ["/high-scores/characters/Star%20Drifter", "/high-scores/characters/[name]", "high-scores"],
    ["/register", "/register", "auth"],
    ["/sign-in", "/sign-in", "auth"],
    ["/characters", "/characters", "characters"],
    ["/characters/new", "/characters/new", "characters"],
    ["/play/0b7d6f2e-1111-4222-8333-444455556666", "/play/[characterId]", "play"],
    ["/definitely/not/a/route", "/other", "other"],
  ])("%s -> %s", (pathname, path, category) => {
    expect(analyticsRouteTemplate(pathname)).toEqual({ path, category });
  });

  it("ignores any query string or fragment passed in", () => {
    expect(analyticsRouteTemplate("/play/abc?surface=map#x")).toEqual({
      path: "/play/[characterId]",
      category: "play",
    });
  });

  it.each(["/admin", "/admin/characters/abc", "/moderation/s1", "/qc-studio", "/api/auth/x"])(
    "does not track %s",
    (pathname) => {
      expect(analyticsRouteTemplate(pathname)).toBeNull();
    },
  );

  it("never echoes a dynamic segment", () => {
    for (const pathname of ["/play/SECRET-ID", "/high-scores/characters/SECRET", "/zzz/SECRET"]) {
      expect(JSON.stringify(analyticsRouteTemplate(pathname))).not.toContain("SECRET");
    }
  });
});

describe("landing attribution", () => {
  it("captures the scapelikes campaign link and a referring domain", () => {
    expect(
      parseLandingAttribution("?utm_source=scapelikes&utm_medium=listing&utm_campaign=launch", ""),
    ).toEqual({
      utm_source: "scapelikes",
      utm_medium: "listing",
      utm_campaign: "launch",
      referring_domain: DIRECT_OR_UNKNOWN_REFERRER,
    });
    expect(parseLandingAttribution("", "https://www.Reddit.com/r/runescape?x=1#y")).toEqual({
      referring_domain: "www.reddit.com",
    });
  });

  it("reads only the three allowlisted keys", () => {
    const attribution = parseLandingAttribution(
      "?token=SECRET&utm_term=SECRET&email=a%40b.c&utm_source=x",
      null,
    );
    expect(JSON.stringify(attribution)).not.toContain("SECRET");
    expect(Object.keys(attribution).sort()).toEqual(["referring_domain", "utm_source"]);
  });

  it("drops unbounded or non-label values whole", () => {
    expect(sanitizeUtmValue("a".repeat(65))).toBeUndefined();
    expect(sanitizeUtmValue("a".repeat(64))).toBe("a".repeat(64));
    expect(sanitizeUtmValue("someone@example.com")).toBeUndefined();
    expect(sanitizeUtmValue("<script>")).toBeUndefined();
    expect(sanitizeUtmValue("  Mixed Case_1.2-3 ")).toBe("mixed case_1.2-3");
    expect(sanitizeUtmValue("")).toBeUndefined();
  });

  it("reports own-site, malformed and non-web referrers as direct/unknown", () => {
    expect(referrerDomain("https://runespace.qcfailed.com/wiki")).toBeUndefined();
    expect(referrerDomain("android-app://com.google.android.gm")).toBeUndefined();
    expect(referrerDomain("garbage")).toBeUndefined();
    expect(referrerDomain("")).toBeUndefined();
    expect(parseLandingAttribution("", "garbage").referring_domain).toBe(
      DIRECT_OR_UNKNOWN_REFERRER,
    );
  });

  it("derives first-touch copies from the same attribution", () => {
    expect(
      firstTouchProperties({ utm_source: "scapelikes", referring_domain: "example.org" }),
    ).toEqual({
      first_touch_referring_domain: "example.org",
      first_touch_utm_source: "scapelikes",
    });
  });
});

describe("sanitizeCapture", () => {
  const sdkPageview = {
    event: "$pageview",
    properties: {
      token: "phc_x",
      distinct_id: "anon-1",
      $current_url:
        "https://runespace.qcfailed.com/play/0b7d6f2e-1111-4222-8333-444455556666?surface=map&token=SECRET",
      $pathname: "/play/0b7d6f2e-1111-4222-8333-444455556666",
      $host: "runespace.qcfailed.com",
      $referrer: "https://www.reddit.com/r/x/comments/SECRET?q=SECRET",
      $referring_domain: "www.reddit.com",
      $initial_current_url: "https://runespace.qcfailed.com/?utm_source=SECRET",
      $session_entry_url: "https://runespace.qcfailed.com/sign-in?verification=SECRET",
      $prev_pageview_pathname: "/play/SECRET",
      $raw_user_agent: "SECRET-UA",
      $ip: "203.0.113.9",
      $browser: "Chrome",
      $device_type: "Desktop",
      first_touch_utm_source: "scapelikes",
      route_category: "play",
      email: "SECRET@example.com",
    },
    $set: { email: "SECRET@example.com" },
    $set_once: { $initial_current_url: "https://runespace.qcfailed.com/?x=SECRET" },
  };

  it("rewrites every URL to its route template and strips person properties", () => {
    const result = sanitizeCapture(sdkPageview)!;
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result.properties).toMatchObject({
      $current_url: "https://runespace.qcfailed.com/play/[characterId]",
      $pathname: "/play/[characterId]",
      $host: "runespace.qcfailed.com",
      $referrer: "https://www.reddit.com",
      $referring_domain: "www.reddit.com",
      route_category: "play",
      first_touch_utm_source: "scapelikes",
      $browser: "Chrome",
      distinct_id: "anon-1",
    });
    expect(result.$set).toBeUndefined();
    expect(result.$set_once).toBeUndefined();
  });

  it("bounds the UTM values the SDK copies from the raw URL", () => {
    const result = sanitizeCapture({
      event: "$pageview",
      properties: {
        $current_url: "https://runespace.qcfailed.com/register?utm_source=SECRET%40example.com",
        utm_source: "SECRET@example.com",
        utm_medium: null,
        utm_campaign: "Launch",
        utm_content: "SECRET",
        gclid: "SECRET",
      },
    })!;
    expect(result.properties.utm_campaign).toBe("launch");
    expect(Object.keys(result.properties)).not.toContain("utm_source");
    expect(Object.keys(result.properties)).not.toContain("utm_medium");
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("reports a missing referrer honestly", () => {
    const result = sanitizeCapture({
      event: "$pageview",
      properties: { $current_url: "https://runespace.qcfailed.com/", $referring_domain: "$direct" },
    })!;
    expect(result.properties.$referrer).toBe("$direct");
    expect(result.properties.$referring_domain).toBe("$direct");
  });

  describe("native referrer fields for a landing pageview", () => {
    // The SDK runs with `save_referrer: false`, so it emits no native referrer
    // fields at all; RuneSpace's own sanitized `referring_domain` is the source.
    const landing = (properties: Record<string, unknown>) =>
      sanitizeCapture({
        event: "$pageview",
        properties: { $current_url: "https://runespace.qcfailed.com/", ...properties },
      })!.properties;

    it("derives them from the sanitized referring domain", () => {
      expect(landing({ referring_domain: "www.linkedin.com" })).toMatchObject({
        $referring_domain: "www.linkedin.com",
        $referrer: "https://www.linkedin.com",
        referring_domain: "www.linkedin.com",
      });
    });

    it("never takes a raw referrer URL from the SDK payload", () => {
      const properties = landing({
        referring_domain: "www.reddit.com",
        $referrer: "https://www.reddit.com/r/x/comments/SECRET?token=SECRET",
      });
      expect(properties.$referrer).toBe("https://www.reddit.com");
      expect(JSON.stringify(properties)).not.toContain("SECRET");
    });

    it.each([
      ["the direct marker", DIRECT_OR_UNKNOWN_REFERRER],
      ["a RuneSpace deployment", "pr-414.runespace.qcfailed.com"],
      ["something that is not a hostname", "https://www.reddit.com/r/x"],
      ["a non-string", 42],
    ])("reports $direct for %s", (_label, value) => {
      expect(landing({ referring_domain: value })).toMatchObject({
        $referring_domain: "$direct",
        $referrer: "$direct",
      });
    });

    it("does not let the first-touch copy stand in for a pageview's own referrer", () => {
      expect(landing({ first_touch_referring_domain: "www.reddit.com" })).toMatchObject({
        $referring_domain: "$direct",
        $referrer: "$direct",
      });
    });
  });

  it("drops events outside the allowlist", () => {
    for (const event of [
      "$autocapture",
      "$pageleave",
      "$exception",
      "$web_vitals",
      "$snapshot",
      "$feature_flag_called",
      "$rageclick",
      "chat_message_sent",
    ]) {
      expect(sanitizeCapture({ event, properties: {} })).toBeNull();
    }
  });

  it("keeps lifecycle events and only their declared properties", () => {
    for (const event of Object.values(ANALYTICS_EVENTS)) {
      expect(sanitizeCapture({ event, properties: { distinct_id: "u1" } })).not.toBeNull();
    }
    const milestone = sanitizeCapture({
      event: ANALYTICS_EVENTS.gameplayMilestoneReached,
      properties: { milestone: "first_xp_gained", characterId: "SECRET", name: "SECRET" },
    })!;
    expect(milestone.properties.milestone).toBe("first_xp_gained");
    expect(JSON.stringify(milestone)).not.toContain("SECRET");
  });

  it("never reports an operator surface, even for a lifecycle event", () => {
    expect(
      sanitizeCapture({
        event: "$pageview",
        properties: { $current_url: "https://runespace.qcfailed.com/admin/characters/abc" },
      }),
    ).toBeNull();
  });

  it("keeps the identify event's anonymous ID and nothing personal", () => {
    const result = sanitizeCapture({
      event: "$identify",
      properties: {
        distinct_id: "user_123",
        $anon_distinct_id: "anon-1",
        $current_url: "https://runespace.qcfailed.com/characters",
      },
      $set: { email: "SECRET@example.com", name: "SECRET" },
    })!;
    expect(result.properties.$anon_distinct_id).toBe("anon-1");
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});

describe("event environment separation", () => {
  const sdkEvent = (event: string, extra: Record<string, unknown> = {}) => ({
    event,
    properties: {
      distinct_id: "u1",
      $current_url: "https://pr-414.runespace.qcfailed.com/play/abc?x=SECRET",
      ...extra,
    },
  });

  it("stamps environment=production on every kind of event", () => {
    for (const event of ["$pageview", "$identify", ...Object.values(ANALYTICS_EVENTS)]) {
      const result = sanitizeCapture(sdkEvent(event), PRODUCTION)!;
      expect(result.properties.environment, event).toBe("production");
      expect(result.properties).not.toHaveProperty("preview_pr");
    }
  });

  it("stamps environment=preview and the PR number on every kind of event", () => {
    for (const event of ["$pageview", "$identify", ...Object.values(ANALYTICS_EVENTS)]) {
      const result = sanitizeCapture(sdkEvent(event), PREVIEW)!;
      expect(result.properties.environment, event).toBe("preview");
      expect(result.properties.preview_pr, event).toBe(414);
    }
  });

  it("stamps events that carry no URL too", () => {
    const result = sanitizeCapture({ event: "gameplay_entered", properties: {} }, PREVIEW)!;
    expect(result.properties).toMatchObject({ environment: "preview", preview_pr: 414 });
  });

  it("derives the environment from the validated host, never from incoming properties", () => {
    const result = sanitizeCapture(
      sdkEvent("$pageview", { environment: "production", preview_pr: 1 }),
      PREVIEW,
    )!;
    expect(result.properties).toMatchObject({ environment: "preview", preview_pr: 414 });
    const asProduction = sanitizeCapture(
      sdkEvent("$pageview", { environment: "preview", preview_pr: 999 }),
      PRODUCTION,
    )!;
    expect(asProduction.properties.environment).toBe("production");
    expect(asProduction.properties).not.toHaveProperty("preview_pr");
  });

  it("reports the real host and template, never the query", () => {
    const preview = sanitizeCapture(sdkEvent("$pageview"), PREVIEW)!;
    expect(preview.properties).toMatchObject({
      $current_url: "https://pr-414.runespace.qcfailed.com/play/[characterId]",
      $host: "pr-414.runespace.qcfailed.com",
    });
    const production = sanitizeCapture(sdkEvent("$pageview"), PRODUCTION)!;
    expect(production.properties.$host).toBe("runespace.qcfailed.com");
    expect(JSON.stringify([preview, production])).not.toContain("SECRET");
  });

  it("does not treat a move between RuneSpace deployments as a referral", () => {
    const result = sanitizeCapture(
      sdkEvent("$pageview", { $referring_domain: "pr-414.runespace.qcfailed.com" }),
      PRODUCTION,
    )!;
    expect(result.properties.$referring_domain).toBe("$direct");
    expect(referrerDomain("https://pr-414.runespace.qcfailed.com/wiki")).toBeUndefined();
  });
});

describe("event properties", () => {
  it("keeps only declared properties for each event", () => {
    expect(
      eventProperties(ANALYTICS_EVENTS.gameplayMilestoneReached, {
        milestone: "first_xp_gained",
        extra: "x",
      } as never),
    ).toEqual({ milestone: "first_xp_gained" });
    expect(
      eventProperties(ANALYTICS_EVENTS.accountRegistrationSucceeded, { email: "a@b.c" } as never),
    ).toEqual({});
  });
});

describe("first gameplay milestone", () => {
  it("sums skill XP across skills", () => {
    expect(totalSkillXp({})).toBe(0);
    expect(totalSkillXp({ mining: 12, refining: 3 })).toBe(15);
  });

  it("fires only for an observed zero-to-positive change", () => {
    expect(observeFirstXpGain(0, 25)).toBe(true);
    // Already-positive snapshots and later gains are not the first observation.
    expect(observeFirstXpGain(25, 40)).toBe(false);
    expect(observeFirstXpGain(25, 25)).toBe(false);
    // Nothing changed: a tick, tab, or rerender with no XP.
    expect(observeFirstXpGain(0, 0)).toBe(false);
  });
});
