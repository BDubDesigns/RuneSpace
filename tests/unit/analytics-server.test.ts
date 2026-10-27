import { describe, expect, it, vi } from "vitest";
import { reportCharacterCreationSucceeded, serverAnalyticsAllowed } from "@/server/analytics";

const config = {
  token: "phc_vemdyMrA4jSAnccPsASNqkfs6GT5fgB8vZYcZ6gHgr2h",
  apiHost: "https://us.i.posthog.com",
};
const CONSENT = "rs_analytics_choice=on";
const production = { host: "runespace.qcfailed.com", cookie: CONSENT };

function report(
  headers: Record<string, string>,
  userId = "user_123",
  fetchImpl = vi.fn(async () => ({})),
) {
  reportCharacterCreationSucceeded(new Headers(headers), userId, { config, fetchImpl });
  return fetchImpl;
}

describe("server analytics reporter", () => {
  it("posts one allowlisted event for the stable account ID", async () => {
    const fetchImpl = report(production);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      api_key: config.token,
      event: "character_creation_succeeded",
      distinct_id: "user_123",
    });
    expect(Object.keys(body.properties).sort()).toEqual(["$geoip_disable", "$lib"]);
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
    ["a preview", { host: "pr-413.runespace.qcfailed.com", cookie: CONSENT }],
    ["no host", { cookie: CONSENT }],
    ["no consent choice yet (opt-in)", { host: "runespace.qcfailed.com" }],
    ["a declined choice", { ...production, cookie: "a=b; rs_analytics_choice=off" }],
    ["a malformed choice", { ...production, cookie: "rs_analytics_choice=yes" }],
    ["Global Privacy Control", { ...production, "sec-gpc": "1" }],
    ["Do Not Track", { ...production, dnt: "1" }],
  ])("sends nothing for %s", (_label, headers) => {
    expect(report(headers)).not.toHaveBeenCalled();
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
    expect(serverAnalyticsAllowed(new Headers(production), null)).toBe(false);
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
