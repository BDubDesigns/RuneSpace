import { describe, expect, it, vi } from "vitest";
import { reportCharacterCreationSucceeded, serverAnalyticsAllowed } from "@/server/analytics";

const config = {
  token: "phc_vemdyMrA4jSAnccPsASNqkfs6GT5fgB8vZYcZ6gHgr2h",
  apiHost: "https://us.i.posthog.com",
};
const production = { host: "runespace.qcfailed.com" };

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
      report({ host: "localhost:3000", "x-forwarded-host": "runespace.qcfailed.com" }),
    ).toHaveBeenCalled();
    expect(
      report({ host: "runespace.qcfailed.com", "x-forwarded-host": "pr-1.runespace.qcfailed.com" }),
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["localhost", { host: "localhost:3000" }],
    ["a preview", { host: "pr-413.runespace.qcfailed.com" }],
    ["no host", {}],
    ["the opt-out cookie", { ...production, cookie: "a=b; rs_analytics_optout=1" }],
    ["Global Privacy Control", { ...production, "sec-gpc": "1" }],
    ["Do Not Track", { ...production, dnt: "1" }],
  ])("sends nothing for %s", (_label, headers) => {
    expect(report(headers)).not.toHaveBeenCalled();
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
