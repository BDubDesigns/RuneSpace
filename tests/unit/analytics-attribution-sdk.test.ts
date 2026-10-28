// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://runespace.qcfailed.com/"}
import { gunzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Acquisition attribution through the REAL pinned `posthog-js` SDK (issue
 * #421). The production `AnalyticsProvider`, consent prompt and browser wrapper
 * run unmodified in jsdom; only the network transport is stubbed, so what the
 * assertions read is exactly what would have left the browser. Nothing here
 * contacts PostHog.
 */

const TOKEN = "phc_vemdyMrA4jSAnccPsASNqkfs6GT5fgB8vZYcZ6gHgr2h";

// Next's router is not under test: the pathname is a controllable store.
const route = vi.hoisted(() => ({ path: "/", listeners: new Set<() => void>() }));
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () =>
      useSyncExternalStore(
        (listener) => {
          route.listeners.add(listener);
          return () => route.listeners.delete(listener);
        },
        () => route.path,
        () => route.path,
      ),
  };
});
vi.mock("@/features/auth/auth-client", () => ({
  authClient: { useSession: () => ({ data: null, isPending: false }) },
}));
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ href, children }: { href: string; children?: unknown }) =>
      createElement("a", { href }, children as never),
  };
});

/**
 * The transport stubs are installed once for the whole file. The SDK captures
 * `fetch` when its module loads, so replacing the stub per test could leave it
 * holding an old one; this sink is what each page load swaps instead.
 */
/** A request body as text, undoing the SDK's gzip for larger payloads. */
async function bodyText(body: unknown): Promise<string> {
  if (typeof body === "string") return body;
  let bytes: Buffer | undefined;
  if (body instanceof ArrayBuffer) bytes = Buffer.from(body);
  else if (ArrayBuffer.isView(body))
    bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  else if (body instanceof Blob) bytes = Buffer.from(await body.arrayBuffer());
  if (!bytes) return "";
  return (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString("utf8");
}

const wire = {
  requests: [] as Array<{ url: string; body: string }>,
  fetchCalls: 0,
  xhrOpens: 0,
};

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      wire.fetchCalls += 1;

      wire.requests.push({ url: String(input), body: await bodyText(init?.body) });
      return new Response("{}", { status: 200 });
    }),
  );
  // XHR must never reach a real network either; any use is visible to the tests.
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(() => {
    wire.xhrOpens += 1;
  });
  vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => undefined);
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Visit = {
  /** Path and query of the page the visitor lands on. */
  url?: string;
  referrer?: string;
  /** The saved choice cookie. Defaults to none (nothing chosen yet). */
  choice?: "on" | "off";
  gpc?: boolean;
  dnt?: string;
  /** Keep the previous visit's storage and cookies: a return visit. */
  keepStorage?: boolean;
};

type Sent = { event: string; properties: Record<string, unknown> };

let teardown: Array<() => void> = [];

function clearCookies() {
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

function endPreviousPageLoad() {
  for (const undo of teardown.splice(0)) undo();
}

/** One full page load of the real app shell, with the network stubbed. */
async function visit(options: Visit = {}) {
  // A hard page load destroys the old document, and with it every listener.
  endPreviousPageLoad();
  vi.resetModules();
  // setImmediate stays real: it is how `settle` yields to the lazy SDK import.
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  if (!options.keepStorage) {
    localStorage.clear();
    sessionStorage.clear();
    clearCookies();
  }
  if (options.choice) document.cookie = `rs_analytics_choice=${options.choice}; Path=/`;

  const url = options.url ?? "/";
  history.replaceState(null, "", url);
  route.path = new URL(url, location.origin).pathname;
  Object.defineProperty(document, "referrer", {
    configurable: true,
    get: () => options.referrer ?? "",
  });
  Object.defineProperty(navigator, "globalPrivacyControl", {
    configurable: true,
    value: options.gpc,
  });
  Object.defineProperty(navigator, "doNotTrack", {
    configurable: true,
    value: options.dnt ?? null,
  });
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", TOKEN);
  vi.stubEnv("NEXT_PUBLIC_ANALYTICS_PREVIEW_PRS", "");

  wire.requests = [];
  wire.fetchCalls = 0;
  wire.xhrOpens = 0;
  const requests = wire.requests;
  const scriptsBefore = document.scripts.length;

  // Load the real SDK into this registry now, so the app's own lazy import()
  // resolves from cache and a test never races the module download.
  await import("posthog-js");

  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { AnalyticsProvider } = await import("@/features/analytics/AnalyticsProvider");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  teardown.push(() => {
    React.act(() => root.unmount());
    container.remove();
  });

  async function settle(ms = 0) {
    await React.act(async () => {
      // The SDK is a real lazy import: give its I/O a few turns to resolve.
      for (let turn = 0; turn < 5; turn += 1) {
        await vi.dynamicImportSettled();
        await new Promise((resolve) => setImmediate(resolve));
      }
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  await React.act(async () => {
    root.render(React.createElement(AnalyticsProvider));
  });
  await settle();

  const page = {
    requests,
    /** Anything at all that left the page: fetch, XHR, or an injected script. */
    get networkTouched() {
      return wire.fetchCalls > 0 || wire.xhrOpens > 0;
    },
    get scriptsAdded() {
      return document.scripts.length - scriptsBefore;
    },
    get storageKeys() {
      return [
        ...Object.keys(localStorage).map((key) => `local:${key}`),
        ...Object.keys(sessionStorage).map((key) => `session:${key}`),
      ];
    },
    get cookie() {
      return document.cookie;
    },
    promptVisible: () =>
      document.querySelector('[data-testid="analytics-consent-prompt"]') !== null,
    /** Press the real Accept / Decline button (labelled for the player in the prompt). */
    async press(label: "Accept" | "Decline") {
      const text = label === "Accept" ? "Help me improve RuneSpace" : "No thanks";
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent === text);
      expect(button, `${label} button`).toBeTruthy();
      await React.act(async () => {
        button!.click();
      });
      await settle();
    },
    /** The Safety & Privacy toggle, as the client wrapper it calls exposes it. */
    async setChoice(choice: "on" | "off") {
      const client = await import("@/features/analytics/analytics-client");
      await React.act(async () => {
        client.setAnalyticsChoice(choice);
      });
      await settle();
    },
    /** A same-document (SPA) route change, as `next/link` performs it. */
    async navigate(path: string) {
      history.pushState(null, "", path);
      route.path = new URL(path, location.origin).pathname;
      await React.act(async () => {
        for (const listener of route.listeners) listener();
      });
      await settle();
    },
    /** Let the SDK's batch timer fire, then return everything it sent. */
    async sent(): Promise<Sent[]> {
      // About 18 s of page time, in steps with real turns between them: the
      // SDK's batch timer is 3 s but it has async hops of its own before it.
      for (let step = 0; step < 12; step += 1) await settle(1500);
      return requests.flatMap(({ body }) => {
        if (!body) return [];
        const parsed = JSON.parse(body) as { batch?: Sent[] };
        return parsed.batch ?? [];
      });
    },
    async pageviews() {
      return (await this.sent()).filter((e) => e.event === "$pageview");
    },
  };
  return page;
}

beforeEach(() => {
  route.path = "/";
});

afterEach(() => {
  endPreviousPageLoad();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const REDDIT_POST =
  "https://www.reddit.com/r/runescape/comments/abc123/slug/?context=3&token=s3cr3t";

describe("native referrer fields for a consented landing (real SDK)", () => {
  it("reports a Reddit referral as its domain, never as $direct, and never leaks the post URL", async () => {
    const page = await visit({ choice: "on", referrer: REDDIT_POST });
    const [landing] = await page.pageviews();

    expect(landing?.properties).toMatchObject({
      route_category: "landing",
      $referring_domain: "www.reddit.com",
      referring_domain: "www.reddit.com",
      first_touch_referring_domain: "www.reddit.com",
    });
    // Domain-level only: the SDK's own $referrer is the full URL, so it is
    // rebuilt as an origin and no path, query or token can ride along.
    expect(landing?.properties.$referrer).toBe("https://www.reddit.com");
    expect(JSON.stringify(page.requests)).not.toMatch(/abc123|s3cr3t|context=3|\/r\/runescape/);
  });

  it("reports a LinkedIn referral as its domain", async () => {
    const page = await visit({ choice: "on", referrer: "https://www.linkedin.com/" });
    const [landing] = await page.pageviews();
    expect(landing?.properties).toMatchObject({
      $referring_domain: "www.linkedin.com",
      $referrer: "https://www.linkedin.com",
    });
  });

  it.each([
    ["no referrer", undefined],
    ["a referrer from RuneSpace itself", "https://pr-421.runespace.qcfailed.com/wiki"],
    ["a non-web referrer", "android-app://com.discord/"],
  ])("still reports $direct for %s", async (_label, referrer) => {
    const page = await visit({ choice: "on", referrer });
    const [landing] = await page.pageviews();
    expect(landing?.properties).toMatchObject({
      $referring_domain: "$direct",
      $referrer: "$direct",
      referring_domain: "direct_or_unknown",
    });
  });
});

const CAMPAIGN_LANDING =
  "/?utm_source=Reddit&utm_medium=Social&utm_campaign=Launch-Week&utm_content=ignored&token=s3cr3t";

describe("landing attribution held in memory until the visitor accepts (real SDK)", () => {
  it("survives SPA navigation and is attributed to the first permitted pageview", async () => {
    const page = await visit({ url: CAMPAIGN_LANDING, referrer: REDDIT_POST });
    expect(page.promptVisible()).toBe(true);

    await page.navigate("/wiki");
    await page.navigate("/updates");

    // Before consent: nothing sent, nothing stored, no script injected.
    await page.sent();
    expect(page.networkTouched).toBe(false);
    expect(page.scriptsAdded).toBe(0);
    expect(page.storageKeys).toEqual([]);
    expect(page.cookie).toBe("");

    await page.press("Accept");
    const pageviews = await page.pageviews();

    // The pages browsed before saying yes are not replayed.
    expect(pageviews).toHaveLength(1);
    expect(pageviews[0]?.properties).toMatchObject({
      route_category: "updates",
      $pathname: "/updates",
      utm_source: "reddit",
      utm_medium: "social",
      utm_campaign: "launch-week",
      referring_domain: "www.reddit.com",
      $referring_domain: "www.reddit.com",
      $referrer: "https://www.reddit.com",
      first_touch_utm_source: "reddit",
      first_touch_utm_medium: "social",
      first_touch_utm_campaign: "launch-week",
      first_touch_referring_domain: "www.reddit.com",
    });
    expect(JSON.stringify(page.requests)).not.toMatch(/ignored|s3cr3t|abc123/);

    // Used once: later pageviews carry no landing attribution of their own.
    await page.navigate("/high-scores");
    const later = (await page.pageviews())[1];
    expect(later?.properties).toMatchObject({
      route_category: "high-scores",
      $referring_domain: "$direct",
    });
    expect(later?.properties).not.toHaveProperty("utm_source");
    expect(later?.properties).not.toHaveProperty("referring_domain");
    expect(later?.properties.first_touch_utm_source).toBe("reddit");
  });

  it("is attributed to the landing pageview when accepted without navigating", async () => {
    const page = await visit({ url: CAMPAIGN_LANDING, referrer: REDDIT_POST });
    await page.press("Accept");
    const [landing] = await page.pageviews();
    expect(landing?.properties).toMatchObject({
      route_category: "landing",
      utm_source: "reddit",
      $referring_domain: "www.reddit.com",
    });
  });

  it("does not attribute twice when Accept is pressed again", async () => {
    const page = await visit({ url: CAMPAIGN_LANDING, referrer: REDDIT_POST });
    await page.navigate("/wiki");
    await page.press("Accept");
    await page.setChoice("on");
    await page.setChoice("on");
    const pageviews = await page.pageviews();
    expect(pageviews).toHaveLength(1);
    expect(pageviews[0]?.properties.utm_source).toBe("reddit");
  });

  it("discards the buffer when the visitor declines: nothing is sent, and a later yes starts clean", async () => {
    const page = await visit({ url: CAMPAIGN_LANDING, referrer: REDDIT_POST });
    await page.navigate("/wiki");
    await page.press("Decline");

    await page.sent();
    expect(page.networkTouched).toBe(false);
    expect(page.storageKeys).toEqual([]);
    expect(page.cookie).toBe("rs_analytics_choice=off");

    // Changing their mind later (Safety & Privacy) must not resurrect it.
    await page.navigate("/wiki/safety-privacy");
    await page.setChoice("on");
    const [first] = await page.pageviews();
    expect(first?.properties).toMatchObject({ $referring_domain: "$direct" });
    expect(first?.properties).not.toHaveProperty("utm_source");
    expect(first?.properties).not.toHaveProperty("referring_domain");
    expect(first?.properties).not.toHaveProperty("first_touch_referring_domain");
    expect(JSON.stringify(page.requests)).not.toMatch(/reddit/i);
  });

  it.each([
    ["Global Privacy Control", { gpc: true }],
    ["Do Not Track", { dnt: "1" }],
  ])("never buffers under %s, and drops it if the signal later lifts", async (_name, signal) => {
    const page = await visit({ url: CAMPAIGN_LANDING, referrer: REDDIT_POST, ...signal });
    expect(page.promptVisible()).toBe(false);
    await page.navigate("/wiki");
    await page.sent();
    expect(page.networkTouched).toBe(false);
    expect(page.storageKeys).toEqual([]);

    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: null });
    await page.setChoice("on");
    const [first] = await page.pageviews();
    expect(first?.properties).not.toHaveProperty("utm_source");
    expect(JSON.stringify(page.requests)).not.toMatch(/reddit/i);
  });

  it("sends nothing and keeps nothing for a visitor who already declined", async () => {
    const page = await visit({ url: CAMPAIGN_LANDING, referrer: REDDIT_POST, choice: "off" });
    await page.sent();
    expect(page.networkTouched).toBe(false);
    expect(page.storageKeys).toEqual([]);
  });

  it("does not carry attribution across a hard page load", async () => {
    const first = await visit({ url: CAMPAIGN_LANDING, referrer: REDDIT_POST });
    await first.navigate("/wiki");

    // A real navigation: a fresh document whose referrer is this site itself.
    const reloaded = await visit({
      url: "/wiki",
      referrer: "https://runespace.qcfailed.com/",
      keepStorage: true,
    });
    await reloaded.sent();
    expect(reloaded.networkTouched).toBe(false);
    expect(reloaded.storageKeys).toEqual([]);

    await reloaded.press("Accept");
    const [pageview] = await reloaded.pageviews();
    expect(pageview?.properties).toMatchObject({
      referring_domain: "direct_or_unknown",
      $referring_domain: "$direct",
      first_touch_referring_domain: "direct_or_unknown",
    });
    expect(pageview?.properties).not.toHaveProperty("utm_source");
  });

  it("keeps the original first touch when a returning visitor arrives from somewhere else", async () => {
    const original = await visit({ url: CAMPAIGN_LANDING, referrer: REDDIT_POST, choice: "on" });
    await original.pageviews();

    const returning = await visit({
      url: "/?utm_source=linkedin",
      referrer: "https://www.linkedin.com/feed/",
      keepStorage: true,
    });
    const [landing] = await returning.pageviews();
    expect(landing?.properties).toMatchObject({
      utm_source: "linkedin",
      referring_domain: "www.linkedin.com",
      $referring_domain: "www.linkedin.com",
      first_touch_utm_source: "reddit",
      first_touch_referring_domain: "www.reddit.com",
    });
  });

  it("drops malformed and unsafe values whole, and reads nothing outside the allowlist", async () => {
    const unsafe = [
      "utm_source=a%40b.com",
      "utm_medium=%E0%A4%A",
      `utm_campaign=${"x".repeat(65)}`,
      "utm_term=secret-term",
      "gclid=secret-click",
      "email=player%40example.com",
    ].join("&");
    const page = await visit({ url: `/?${unsafe}`, referrer: REDDIT_POST, choice: "on" });
    const [landing] = await page.pageviews();

    expect(landing?.properties).toMatchObject({ referring_domain: "www.reddit.com" });
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "gclid"]) {
      expect(landing?.properties).not.toHaveProperty(key);
    }
    expect(JSON.stringify(page.requests)).not.toMatch(/secret|example\.com|xxxxxxxx|a%40b/);
  });
});
