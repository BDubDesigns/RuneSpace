import { describe, expect, it, vi } from "vitest";
import { reportCharacterCreationSucceeded, serverAnalyticsEnvironment } from "@/server/analytics";

const TOKEN = "phc_vemdyMrA4jSAnccPsASNqkfs6GT5fgB8vZYcZ6gHgr2h";
const config = { token: TOKEN, apiHost: "https://us.i.posthog.com", previewPrs: [] as number[] };
const previewConfig = { ...config, previewPrs: [414] };
const CONSENT = "rs_analytics_choice=on";
const production = { host: "runespace.qcfailed.com", cookie: CONSENT };
const preview = { host: "pr-414.runespace.qcfailed.com", cookie: CONSENT };

function report(
  headers: Record<string, string>,
  userId = "user_123",
  fetchImpl = vi.fn(async () => ({})),
  withConfig: typeof config | null = config,
) {
  reportCharacterCreationSucceeded(new Headers(headers), userId, {
    config: withConfig,
    fetchImpl,
  });
  return fetchImpl;
}

function body(fetchImpl: ReturnType<typeof vi.fn>) {
  const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(String(init.body));
}

describe("server analytics reporter", () => {
  it("posts one allowlisted event for the stable account ID, labeled production", () => {
    const fetchImpl = report(production);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    const sent = body(fetchImpl);
    expect(sent).toMatchObject({
      api_key: TOKEN,
      event: "character_creation_succeeded",
      distinct_id: "user_123",
    });
    expect(sent.properties).toEqual({
      $lib: "runespace-server",
      $geoip_disable: true,
      environment: "production",
    });
  });

  it("labels an explicitly enabled preview with its PR number", () => {
    const fetchImpl = report(preview, "user_9", undefined, previewConfig);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(body(fetchImpl).properties).toEqual({
      $lib: "runespace-server",
      $geoip_disable: true,
      environment: "preview",
      preview_pr: 414,
    });
  });

  it("sends nothing from a preview unless its PR is listed", () => {
    expect(report(preview, "u", undefined, config)).not.toHaveBeenCalled();
    expect(
      report(preview, "u", undefined, { ...config, previewPrs: [415] }),
    ).not.toHaveBeenCalled();
  });

  it("enabling a preview never changes production", () => {
    const fetchImpl = report(production, "u", undefined, previewConfig);
    expect(body(fetchImpl).properties.environment).toBe("production");
    expect(body(fetchImpl).properties).not.toHaveProperty("preview_pr");
  });

  it("honors x-forwarded-host ahead of host", () => {
    expect(
      report({
        host: "localhost:3000",
        "x-forwarded-host": "runespace.qcfailed.com",
        cookie: CONSENT,
      }),
    ).toHaveBeenCalled();
    expect(
      report({
        host: "runespace.qcfailed.com",
        "x-forwarded-host": "pr-1.runespace.qcfailed.com",
        cookie: CONSENT,
      }),
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["localhost", { host: "localhost:3000", cookie: CONSENT }],
    ["loopback", { host: "127.0.0.1:3200", cookie: CONSENT }],
    ["no host", { cookie: CONSENT }],
    [
      "a spoofed preview suffix",
      { host: "pr-414.runespace.qcfailed.com.evil.example", cookie: CONSENT },
    ],
    ["no consent choice yet (opt-in)", { host: "runespace.qcfailed.com" }],
    ["a declined choice", { ...production, cookie: "a=b; rs_analytics_choice=off" }],
    ["a malformed choice", { ...production, cookie: "rs_analytics_choice=yes" }],
    ["Global Privacy Control", { ...production, "sec-gpc": "1" }],
    ["Do Not Track", { ...production, dnt: "1" }],
  ])("sends nothing for %s (even with a preview enabled)", (_label, headers) => {
    expect(report(headers, "u", undefined, previewConfig)).not.toHaveBeenCalled();
  });

  it("applies the same privacy gates to an enabled preview", () => {
    expect(
      report({ ...preview, "sec-gpc": "1" }, "u", undefined, previewConfig),
    ).not.toHaveBeenCalled();
    expect(report({ ...preview, dnt: "1" }, "u", undefined, previewConfig)).not.toHaveBeenCalled();
    expect(report({ host: preview.host }, "u", undefined, previewConfig)).not.toHaveBeenCalled();
    expect(
      report(
        { ...preview, cookie: `${CONSENT}; rs_analytics_signal=1` },
        "u",
        undefined,
        previewConfig,
      ),
    ).not.toHaveBeenCalled();
  });

  it("honors a browser-reported privacy signal even when no signal header arrives", () => {
    // A proxy that strips Sec-GPC / DNT cannot hide the browser's own signal:
    // the client mirrors it into a session cookie that overrides a stored yes.
    expect(
      report({ ...production, cookie: `${CONSENT}; rs_analytics_signal=1` }),
    ).not.toHaveBeenCalled();
    expect(
      report({ ...production, cookie: `${CONSENT}; rs_analytics_signal=0` }),
    ).toHaveBeenCalled();
  });

  it("sends nothing when analytics is not configured", () => {
    const fetchImpl = vi.fn(async () => ({}));
    reportCharacterCreationSucceeded(new Headers(production), "u", { config: null, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(serverAnalyticsEnvironment(new Headers(production), null)).toBeNull();
  });

  it("resolves the environment from the request alone", () => {
    expect(serverAnalyticsEnvironment(new Headers(production), config)).toMatchObject({
      environment: "production",
    });
    expect(serverAnalyticsEnvironment(new Headers(preview), previewConfig)).toMatchObject({
      environment: "preview",
      pr: 414,
    });
  });

  it("never throws or rejects when PostHog fails", async () => {
    const rejecting = vi.fn(async () => {
      throw new Error("PostHog unavailable");
    });
    const throwing = vi.fn(() => {
      throw new Error("synchronous failure");
    });
    expect(() => report(production, "u", rejecting)).not.toThrow();
    expect(() => report(production, "u", throwing as never)).not.toThrow();
    await Promise.resolve();
  });
});
