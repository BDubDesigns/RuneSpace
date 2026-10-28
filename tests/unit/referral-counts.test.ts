import { describe, expect, it } from "vitest";
import {
  classifySourceGroup,
  countedRouteCategory,
  hasStatsOptOut,
  isCountingHost,
  looksAutomated,
  referralCountLabels,
  statsOptOutCookie,
  utcDay,
} from "@/features/analytics/referral-counts";

const CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const NAVIGATION: Record<string, string> = {
  host: "runespace.qcfailed.com",
  "user-agent": CHROME,
  accept: "text/html,application/xhtml+xml",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
};

function labels(
  headers: Record<string, string | null> = {},
  path = "/",
  search = "",
  method = "GET",
) {
  const merged = { ...NAVIGATION, ...headers };
  const real = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== null)) as Record<
    string,
    string
  >;
  return referralCountLabels({ method, pathname: path, search, headers: new Headers(real) });
}

describe("classifySourceGroup", () => {
  it.each([
    ["https://www.linkedin.com/feed/", undefined, "linkedin"],
    ["https://lnkd.in/abc", undefined, "linkedin"],
    ["https://old.reddit.com/r/x", undefined, "reddit"],
    ["https://out.reddit.com/", undefined, "reddit"],
    ["https://discord.com/channels/1/2", undefined, "discord"],
    ["https://discord.gg/xyz", undefined, "discord"],
    ["https://www.google.com/", undefined, "google"],
    ["https://www.google.co.uk/search", undefined, "google"],
    ["https://google.com.au/", undefined, "google"],
    ["https://duckduckgo.com/", undefined, "duckduckgo"],
    ["https://t.co/abc", undefined, "x"],
    ["https://news.ycombinator.com/item?id=1", undefined, "hacker_news"],
    ["https://qcfailed.com/", undefined, "qcfailed"],
  ] as const)("files %s under %s", (referer, utm, expected) => {
    expect(classifySourceGroup(referer, utm)).toBe(expected);
  });

  it("does not match look-alike domains", () => {
    expect(classifySourceGroup("https://notlinkedin.com/", undefined)).toBe("other");
    expect(classifySourceGroup("https://linkedin.com.evil.example/", undefined)).toBe("other");
    expect(classifySourceGroup("https://google.evil.example/", undefined)).toBe("other");
    expect(classifySourceGroup("https://box.com/", undefined)).toBe("other");
  });

  it("falls back to utm_source only when the referrer is missing, internal, or unknown", () => {
    expect(classifySourceGroup(null, "linkedin")).toBe("linkedin");
    expect(classifySourceGroup(undefined, "twitter")).toBe("x");
    expect(classifySourceGroup("https://example.org/", "reddit")).toBe("reddit");
    expect(classifySourceGroup("https://runespace.qcfailed.com/wiki", "discord")).toBe("discord");
    // A recognised referrer wins over a contradicting tag.
    expect(classifySourceGroup("https://www.reddit.com/", "linkedin")).toBe("reddit");
  });

  it("separates internal, other, and direct/unknown", () => {
    expect(classifySourceGroup("https://runespace.qcfailed.com/wiki", undefined)).toBe("internal");
    expect(classifySourceGroup("https://pr-12.runespace.qcfailed.com/", undefined)).toBe(
      "internal",
    );
    expect(classifySourceGroup("https://example.org/a?b=c", undefined)).toBe("other");
    expect(classifySourceGroup(null, "some-newsletter")).toBe("other");
    expect(classifySourceGroup(null, undefined)).toBe("direct_unknown");
    expect(classifySourceGroup("not a url", undefined)).toBe("direct_unknown");
    expect(classifySourceGroup("android-app://com.linkedin.android", undefined)).toBe(
      "direct_unknown",
    );
  });
});

describe("referralCountLabels", () => {
  it("counts a production document navigation with sanitized labels only", () => {
    const result = labels(
      { referer: "https://www.linkedin.com/feed/update/secret-id?trk=zzz" },
      "/wiki/getting-started",
      "?utm_source=LinkedIn&utm_medium=Social&utm_campaign=Launch-1&email=a@b.c",
    );
    expect(result).toEqual({
      sourceGroup: "linkedin",
      utmSource: "linkedin",
      utmMedium: "social",
      utmCampaign: "launch-1",
      routeCategory: "wiki",
    });
    // Strict minimization: exactly these five labels, nothing request-shaped.
    expect(Object.keys(result!).sort()).toEqual([
      "routeCategory",
      "sourceGroup",
      "utmCampaign",
      "utmMedium",
      "utmSource",
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /secret-id|trk|a@b|getting-started|Mozilla|linkedin\.com/,
    );
  });

  it("drops invalid UTM values whole instead of storing them", () => {
    const result = labels(
      {},
      "/",
      `?utm_source=${"a".repeat(65)}&utm_medium=a%40b.c&utm_campaign=ok`,
    );
    expect(result).toMatchObject({ utmSource: "", utmMedium: "", utmCampaign: "ok" });
  });

  it("counts only the production host, honoring forwarded host and port", () => {
    expect(labels({ host: "runespace.qcfailed.com:443" })).not.toBeNull();
    expect(
      labels({ host: "10.0.0.2:3000", "x-forwarded-host": "runespace.qcfailed.com" }),
    ).not.toBeNull();
    expect(
      labels({ host: "runespace.qcfailed.com", "x-forwarded-host": "pr-1.runespace.qcfailed.com" }),
    ).toBeNull();
    for (const host of [
      "pr-414.runespace.qcfailed.com",
      "localhost:3000",
      "127.0.0.1:3000",
      "runespace.qcfailed.com.evil.example",
      "evilrunespace.qcfailed.com",
      "qcfailed.com",
    ]) {
      expect(labels({ host }), host).toBeNull();
    }
  });

  it("allows one extra hostname only when the caller (the E2E runtime) passes it", () => {
    const request = {
      method: "GET",
      pathname: "/",
      search: "",
      headers: new Headers({ ...NAVIGATION, host: "localhost:3400" }),
    };
    expect(referralCountLabels(request)).toBeNull();
    expect(referralCountLabels(request, { extraHostname: "localhost" })).not.toBeNull();
    expect(isCountingHost(new Headers({ host: "evil.localhost" }), "localhost")).toBe(false);
  });

  it("counts only GET document navigations that Fetch Metadata identifies", () => {
    expect(labels({}, "/", "", "POST")).toBeNull();
    expect(labels({}, "/", "", "HEAD")).toBeNull();
    // Browsers without Fetch Metadata are undercounted by design.
    expect(labels({ "sec-fetch-mode": null, "sec-fetch-dest": null })).toBeNull();
    // Client-side (RSC) navigations and prefetches are fetch() calls.
    expect(labels({ "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" })).toBeNull();
    expect(labels({ "sec-fetch-mode": "same-origin", "sec-fetch-dest": "empty" })).toBeNull();
    // Frames and images are not page loads.
    expect(labels({ "sec-fetch-dest": "iframe" })).toBeNull();
    expect(labels({ "sec-fetch-dest": "image" })).toBeNull();
    expect(labels({ accept: "application/json" })).toBeNull();
    expect(labels({ accept: null })).toBeNull();
    // Speculative loads.
    expect(labels({ purpose: "prefetch" })).toBeNull();
    expect(labels({ "sec-purpose": "prefetch;prerender" })).toBeNull();
  });

  it("does not count a visitor who objected or sent a privacy signal", () => {
    expect(labels({ "sec-gpc": "1" })).toBeNull();
    expect(labels({ dnt: "1" })).toBeNull();
    expect(labels({ cookie: "a=b; rs_stats_optout=1; c=d" })).toBeNull();
    // The browser's PostHog privacy-signal mirror also wins.
    expect(labels({ cookie: "rs_analytics_signal=1" })).toBeNull();
    // Signals that say "no objection" do not block counting.
    expect(labels({ "sec-gpc": "0", dnt: "0" })).not.toBeNull();
    // The PostHog choice is independent: neither value changes counting.
    expect(labels({ cookie: "rs_analytics_choice=off" })).not.toBeNull();
    expect(labels({ cookie: "rs_analytics_choice=on" })).not.toBeNull();
    expect(labels({ cookie: "rs_stats_optout=0" })).not.toBeNull();
  });

  it("does not count crawlers, previewers, automation, or a missing User-Agent", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "LinkedInBot/1.0 (compatible; Mozilla/5.0)",
      "Mozilla/5.0 (compatible; Discordbot/2.0)",
      "facebookexternalhit/1.1",
      "Slackbot-LinkExpanding 1.0",
      "Mozilla/5.0 HeadlessChrome/130.0",
      "python-requests/2.31",
      "curl/8.5.0",
      "Pingdom.com_bot_version_1.4",
    ]) {
      expect(looksAutomated(ua), ua).toBe(true);
      expect(labels({ "user-agent": ua }), ua).toBeNull();
    }
    expect(labels({ "user-agent": null })).toBeNull();
    for (const ua of [
      CHROME,
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
    ]) {
      expect(looksAutomated(ua), ua).toBe(false);
    }
  });

  it.each([
    ["/", "landing"],
    ["/updates", "updates"],
    ["/updates/some-article", "updates"],
    ["/wiki", "wiki"],
    ["/wiki/items/slug", "wiki"],
    ["/high-scores", "high-scores"],
    ["/high-scores/characters/Abc", "high-scores"],
    ["/register", "auth"],
    ["/sign-in", "auth"],
  ])("counts %s as %s", (path, category) => {
    expect(labels({}, path)?.routeCategory).toBe(category);
  });

  it.each([
    "/play/abc",
    "/characters",
    "/characters/new",
    "/admin",
    "/admin/audit",
    "/moderation",
    "/qc-studio",
    "/design-system",
    "/api/auth/get-session",
    "/api/visit-count-preference",
    "/_next/static/chunk.js",
    "/wiki-not-a-route",
    "/feed.xml",
    "/something-unknown",
    "/register/extra",
  ])("never counts %s", (path) => {
    expect(countedRouteCategory(path)).toBeNull();
    expect(labels({}, path)).toBeNull();
  });
});

describe("visit-count objection cookie", () => {
  it("is recognised only as exactly rs_stats_optout=1", () => {
    expect(hasStatsOptOut("rs_stats_optout=1")).toBe(true);
    expect(hasStatsOptOut("x=1; rs_stats_optout=1")).toBe(true);
    expect(hasStatsOptOut("rs_stats_optout=0")).toBe(false);
    expect(hasStatsOptOut("xrs_stats_optout=1")).toBe(false);
    expect(hasStatsOptOut(null)).toBe(false);
  });

  it("builds the same attributes for setting and clearing", () => {
    expect(statsOptOutCookie(false, false)).toBe(
      "rs_stats_optout=1; Max-Age=31536000; Path=/; SameSite=Lax",
    );
    expect(statsOptOutCookie(false, true)).toMatch(/; Secure$/);
    expect(statsOptOutCookie(true, true)).toBe(
      "rs_stats_optout=; Max-Age=0; Path=/; SameSite=Lax; Secure",
    );
  });
});

describe("utcDay", () => {
  it("is the UTC calendar day, not the local one", () => {
    expect(utcDay(new Date("2026-10-28T23:59:59.999Z"))).toBe("2026-10-28");
    expect(utcDay(new Date("2026-10-29T00:00:00.000Z"))).toBe("2026-10-29");
  });
});
