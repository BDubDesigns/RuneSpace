import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "phc_vemdyMrA4jSAnccPsASNqkfs6GT5fgB8vZYcZ6gHgr2h";

type Env = {
  hostname?: string;
  search?: string;
  cookie?: string;
  referrer?: string;
  gpc?: boolean;
  dnt?: string | null;
  token?: string;
};

const posthog = {
  __loaded: false,
  init: vi.fn(function (this: typeof posthog) {
    this.__loaded = true;
  }),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  register_once: vi.fn(),
  opt_out_capturing: vi.fn(),
  opt_in_capturing: vi.fn(),
  has_opted_out_capturing: vi.fn(() => false),
  get_distinct_id: vi.fn(() => "anon-1"),
  get_property: vi.fn((): unknown => undefined),
};
vi.mock("posthog-js", () => ({ default: posthog }));

async function load(env: Env = {}) {
  vi.resetModules();
  const document = { cookie: env.cookie ?? "", referrer: env.referrer ?? "" };
  vi.stubGlobal("window", {
    location: {
      hostname: env.hostname ?? "runespace.qcfailed.com",
      protocol: "https:",
      search: env.search ?? "",
    },
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", { globalPrivacyControl: env.gpc, doNotTrack: env.dnt ?? null });
  vi.stubGlobal(
    "Event",
    class FakeEvent {
      constructor(readonly type: string) {}
    },
  );
  if (env.token === undefined) vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", TOKEN);
  else vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", env.token);
  const client = await import("@/features/analytics/analytics-client");
  return { client, document };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  posthog.__loaded = false;
  for (const fn of Object.values(posthog))
    if (typeof fn === "function" && "mockClear" in fn) fn.mockClear();
  posthog.get_distinct_id.mockReturnValue("anon-1");
  posthog.get_property.mockReturnValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("analytics gating", () => {
  it.each([
    ["localhost", { hostname: "localhost" }, "wrong-host"],
    ["a PR preview", { hostname: "pr-413.runespace.qcfailed.com" }, "wrong-host"],
    ["a missing token", { token: "" }, "unconfigured"],
    ["Global Privacy Control", { gpc: true }, "privacy-signal"],
    ["Do Not Track", { dnt: "1" }, "privacy-signal"],
    ["the opt-out cookie", { cookie: "rs_analytics_optout=1" }, "opted-out"],
  ] as const)("is disabled for %s and sends nothing", async (_label, env, status) => {
    const { client } = await load(env);
    expect(client.analyticsStatus()).toBe(status);
    client.trackAnalyticsEvent("account_registration_succeeded");
    client.trackAnalyticsPageview("/", true);
    client.identifyAnalyticsAccount("user_1");
    client.resetAnalyticsIdentity();
    await expect(client.startAnalytics()).resolves.toBeNull();
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("initialises with every automatic capture explicitly disabled", async () => {
    const { client } = await load();
    await client.startAnalytics();
    expect(posthog.init).toHaveBeenCalledTimes(1);
    const [token, config] = posthog.init.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(token).toBe(TOKEN);
    expect(config).toMatchObject({
      api_host: "https://us.i.posthog.com",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      person_profiles: "identified_only",
      persistence: "localStorage",
      respect_dnt: true,
    });
    expect(typeof config.before_send).toBe("function");
  });
});

describe("analytics events", () => {
  it("records a landing pageview with attribution and first-touch once", async () => {
    const { client } = await load({
      search: "?utm_source=scapelikes&session=SECRET",
      referrer: "https://www.example.org/post?id=SECRET",
    });
    client.trackAnalyticsPageview("/", true);
    client.trackAnalyticsPageview("/wiki", false);
    await settle();
    expect(posthog.capture).toHaveBeenNthCalledWith(1, "$pageview", {
      route_category: "landing",
      utm_source: "scapelikes",
      referring_domain: "www.example.org",
    });
    expect(posthog.capture).toHaveBeenNthCalledWith(2, "$pageview", { route_category: "wiki" });
    expect(posthog.register_once).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(posthog.capture.mock.calls)).not.toContain("SECRET");
  });

  it("does not record a pageview for an operator route", async () => {
    const { client } = await load();
    client.trackAnalyticsPageview("/admin/characters/abc", false);
    await settle();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("records a lifecycle event with only its declared properties", async () => {
    const { client } = await load();
    client.trackAnalyticsEvent("gameplay_milestone_reached", {
      milestone: "first_xp_gained",
      characterId: "SECRET",
    } as never);
    client.trackAnalyticsEvent("account_registration_succeeded");
    await settle();
    expect(posthog.capture).toHaveBeenNthCalledWith(1, "gameplay_milestone_reached", {
      milestone: "first_xp_gained",
    });
    expect(posthog.capture).toHaveBeenNthCalledWith(2, "account_registration_succeeded", {});
  });
});

describe("analytics identity", () => {
  it("identifies by the stable account ID with no person properties, once", async () => {
    const { client } = await load();
    client.identifyAnalyticsAccount("user_1");
    await settle();
    expect(posthog.identify).toHaveBeenCalledWith("user_1");
    posthog.get_distinct_id.mockReturnValue("user_1");
    client.identifyAnalyticsAccount("user_1");
    await settle();
    expect(posthog.identify).toHaveBeenCalledTimes(1);
  });

  it("resets on sign-out only when an identity exists", async () => {
    const { client } = await load();
    client.resetAnalyticsIdentity();
    await settle();
    expect(posthog.reset).not.toHaveBeenCalled();
    posthog.get_property.mockReturnValue("identified");
    client.resetAnalyticsIdentity();
    await settle();
    expect(posthog.reset).toHaveBeenCalledTimes(1);
  });
});

describe("privacy choice", () => {
  it("opting out stores the cookie, stops the SDK, and notifies listeners", async () => {
    const { client, document } = await load();
    await client.startAnalytics();
    client.setAnalyticsOptOut(true);
    await settle();
    expect(document.cookie).toContain("rs_analytics_optout=1");
    expect(document.cookie).toContain("Max-Age=31536000");
    expect(posthog.opt_out_capturing).toHaveBeenCalled();
    expect(posthog.reset).toHaveBeenCalled();
    expect(window.dispatchEvent).toHaveBeenCalled();
  });

  it("opting back in clears the cookie and resumes the loaded SDK", async () => {
    const { client, document } = await load({ cookie: "rs_analytics_optout=1" });
    expect(client.analyticsOptedOut()).toBe(true);
    // A real browser applies the cookie change; mirror it for the status read.
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: () => undefined,
    });
    client.setAnalyticsOptOut(false);
    posthog.__loaded = true;
    posthog.has_opted_out_capturing.mockReturnValue(true);
    await client.startAnalytics();
    expect(posthog.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
  });
});
