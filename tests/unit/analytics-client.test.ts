import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "phc_vemdyMrA4jSAnccPsASNqkfs6GT5fgB8vZYcZ6gHgr2h";

type Env = {
  hostname?: string;
  search?: string;
  /** The saved choice cookie. Defaults to an explicit yes. */
  choice?: "on" | "off" | null;
  referrer?: string;
  gpc?: boolean;
  dnt?: string | null;
  windowDnt?: string;
  msDnt?: string;
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

/** Holds the lazy `import("posthog-js")` open until a test releases it. */
const sdkImport = vi.hoisted(() => ({ gate: Promise.resolve() as Promise<void> }));
vi.mock("posthog-js", async () => {
  await sdkImport.gate;
  return { default: posthog };
});

function deferImport(): () => void {
  let release!: () => void;
  sdkImport.gate = new Promise<void>((resolve) => (release = resolve));
  return release;
}

/** A cookie jar with real set/read/delete semantics for the attributes used. */
function cookieJar(initial: Record<string, string>) {
  const jar = new Map(Object.entries(initial));
  return {
    jar,
    get cookie() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set cookie(line: string) {
      const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const expired = attributes.some((attribute) => /^max-age=0$/i.test(attribute));
      if (expired || value === "") jar.delete(name);
      else jar.set(name, value);
    },
  };
}

async function load(env: Env = {}) {
  vi.resetModules();
  const choice = env.choice === undefined ? "on" : env.choice;
  const document = Object.assign(cookieJar(choice ? { rs_analytics_choice: choice } : {}), {
    referrer: env.referrer ?? "",
  });
  const win = {
    location: {
      hostname: env.hostname ?? "runespace.qcfailed.com",
      protocol: "https:",
      search: env.search ?? "",
    },
    dispatchEvent: vi.fn(),
    doNotTrack: env.windowDnt,
  };
  const navigator = {
    globalPrivacyControl: env.gpc,
    doNotTrack: env.dnt ?? null,
    msDoNotTrack: env.msDnt,
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", navigator);
  vi.stubGlobal(
    "Event",
    class FakeEvent {
      constructor(readonly type: string) {}
    },
  );
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", env.token === undefined ? TOKEN : env.token);
  const client = await import("@/features/analytics/analytics-client");
  return { client, document, navigator, win };
}

/** Load the module and wait for the lazily imported SDK, so each call below is deterministic. */
async function loadStarted(env: Env = {}) {
  const loaded = await load(env);
  await loaded.client.startAnalytics();
  return loaded;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  sdkImport.gate = Promise.resolve();
  posthog.__loaded = false;
  for (const fn of Object.values(posthog))
    if (typeof fn === "function" && "mockClear" in fn) fn.mockClear();
  posthog.has_opted_out_capturing.mockReturnValue(false);
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
    ["no choice yet (opt-in)", { choice: null }, "needs-consent"],
    ["a declined choice", { choice: "off" }, "declined"],
    ["Global Privacy Control", { gpc: true }, "privacy-signal"],
    ["Do Not Track", { dnt: "1" }, "privacy-signal"],
    ["legacy window.doNotTrack", { windowDnt: "1" }, "privacy-signal"],
    ["legacy msDoNotTrack", { msDnt: "1" }, "privacy-signal"],
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

  it("is permitted only with an explicit yes", async () => {
    const { client } = await load({ choice: "on" });
    expect(client.analyticsStatus()).toBe("permitted");
  });

  it("lets a privacy signal win over a stored yes", async () => {
    const { client } = await load({ choice: "on", gpc: true });
    expect(client.analyticsPermitted()).toBe(false);
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

  it("drops an event at the SDK boundary once permission is withdrawn", async () => {
    const { client } = await load();
    await client.startAnalytics();
    const { before_send } = (
      posthog.init.mock.calls[0] as unknown as [string, Record<string, unknown>]
    )[1] as {
      before_send: (capture: { event: string; properties: Record<string, unknown> }) => unknown;
    };
    const capture = {
      event: "$pageview",
      properties: { $current_url: "https://runespace.qcfailed.com/" },
    };
    expect(before_send(capture)).not.toBeNull();
    client.setAnalyticsChoice("off");
    expect(before_send(capture)).toBeNull();
  });
});

describe("analytics events", () => {
  it("records a landing pageview with attribution and first-touch once", async () => {
    const { client } = await loadStarted({
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
    const { client } = await loadStarted();
    client.trackAnalyticsPageview("/admin/characters/abc", false);
    await settle();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("records a lifecycle event with only its declared properties", async () => {
    const { client } = await loadStarted();
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
    const { client } = await loadStarted();
    client.identifyAnalyticsAccount("user_1");
    await settle();
    expect(posthog.identify).toHaveBeenCalledWith("user_1");
    posthog.get_distinct_id.mockReturnValue("user_1");
    client.identifyAnalyticsAccount("user_1");
    await settle();
    expect(posthog.identify).toHaveBeenCalledTimes(1);
  });

  it("resets on sign-out only when an identity exists", async () => {
    const { client } = await loadStarted();
    client.resetAnalyticsIdentity();
    await settle();
    expect(posthog.reset).not.toHaveBeenCalled();
    posthog.get_property.mockReturnValue("identified");
    client.resetAnalyticsIdentity();
    await settle();
    expect(posthog.reset).toHaveBeenCalledTimes(1);
  });
});

describe("visitor choice", () => {
  it("accepting stores the choice, starts analytics, and notifies listeners", async () => {
    const { client, document, win } = await load({ choice: null });
    expect(client.analyticsStatus()).toBe("needs-consent");
    client.setAnalyticsChoice("on");
    expect(document.jar.get("rs_analytics_choice")).toBe("on");
    expect(client.analyticsStatus()).toBe("permitted");
    expect(win.dispatchEvent).toHaveBeenCalled();
    await expect(client.startAnalytics()).resolves.toBe(posthog);
  });

  it("declining stores the choice, stops the SDK, and notifies listeners", async () => {
    const { client, document, win } = await load();
    await client.startAnalytics();
    client.setAnalyticsChoice("off");
    await settle();
    expect(document.jar.get("rs_analytics_choice")).toBe("off");
    expect(posthog.opt_out_capturing).toHaveBeenCalled();
    expect(posthog.reset).toHaveBeenCalled();
    expect(win.dispatchEvent).toHaveBeenCalled();
    expect(client.analyticsStatus()).toBe("declined");
  });

  it("accepting again resumes an SDK that was opted out", async () => {
    const { client } = await load();
    await client.startAnalytics();
    client.setAnalyticsChoice("off");
    await settle();
    posthog.has_opted_out_capturing.mockReturnValue(true);
    client.setAnalyticsChoice("on");
    await client.startAnalytics();
    expect(posthog.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
    expect(posthog.init).toHaveBeenCalledTimes(1);
  });
});

describe("privacy signal cookie", () => {
  it("mirrors the browser's Global Privacy Control so the server can honor it", async () => {
    const { client, document, navigator } = await load({ gpc: true });
    client.syncPrivacySignalCookie();
    expect(document.jar.get("rs_analytics_signal")).toBe("1");
    (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl = false;
    client.syncPrivacySignalCookie();
    expect(document.jar.has("rs_analytics_signal")).toBe(false);
  });

  it("mirrors Do Not Track too", async () => {
    const { client, document } = await load({ dnt: "1" });
    client.syncPrivacySignalCookie();
    expect(document.jar.get("rs_analytics_signal")).toBe("1");
  });

  it("writes nothing where analytics cannot run", async () => {
    for (const env of [{ hostname: "localhost" }, { token: "" }] as const) {
      const { client, document } = await load({ ...env, gpc: true });
      client.syncPrivacySignalCookie();
      expect(document.jar.has("rs_analytics_signal")).toBe(false);
    }
  });
});

describe("permission changing after an asynchronous step", () => {
  it("declining while the SDK is loading never initialises or emits", async () => {
    const { client } = await load();
    const release = deferImport();
    const started = client.startAnalytics();
    client.trackAnalyticsPageview("/", true);
    client.trackAnalyticsEvent("account_registration_succeeded");
    client.identifyAnalyticsAccount("user_1");

    client.setAnalyticsChoice("off");
    release();

    await expect(started).resolves.toBeNull();
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.register_once).not.toHaveBeenCalled();
  });

  it("declining after the SDK is ready but before a queued action runs drops the action", async () => {
    const { client } = await loadStarted();
    client.trackAnalyticsEvent("gameplay_entered");
    client.trackAnalyticsPageview("/wiki", false);
    client.identifyAnalyticsAccount("user_1");
    // Synchronous: the three actions above are still waiting on the SDK promise.
    client.setAnalyticsChoice("off");
    await settle();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.opt_out_capturing).toHaveBeenCalled();
  });

  it("a privacy signal appearing while the SDK loads blocks initialisation", async () => {
    const { client, navigator } = await load();
    const release = deferImport();
    const started = client.startAnalytics();
    (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl = true;
    release();
    await expect(started).resolves.toBeNull();
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("a withdrawal during loading is not cached, so a later accept still starts", async () => {
    const { client } = await load();
    const release = deferImport();
    const started = client.startAnalytics();
    client.setAnalyticsChoice("off");
    release();
    await expect(started).resolves.toBeNull();
    expect(posthog.init).not.toHaveBeenCalled();

    client.setAnalyticsChoice("on");
    await expect(client.startAnalytics()).resolves.toBe(posthog);
    expect(posthog.init).toHaveBeenCalledTimes(1);
    client.trackAnalyticsEvent("gameplay_entered");
    await settle();
    expect(posthog.capture).toHaveBeenCalledWith("gameplay_entered", {});
  });

  it("an accept that arrives during loading of a withdrawn start still works once", async () => {
    const { client } = await load();
    const release = deferImport();
    const first = client.startAnalytics();
    client.setAnalyticsChoice("off");
    client.setAnalyticsChoice("on");
    release();
    await first;
    await expect(client.startAnalytics()).resolves.toBe(posthog);
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled();
  });
});
