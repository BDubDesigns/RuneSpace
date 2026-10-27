import { describe, expect, it } from "vitest";
import {
  ANALYTICS_PRODUCTION_HOSTNAME,
  DEFAULT_POSTHOG_HOST,
  hasOptOutCookie,
  hasPrivacySignal,
  isAnalyticsHost,
  resolveAnalyticsConfig,
} from "@/features/analytics/analytics-policy";

const TOKEN = "phc_vemdyMrA4jSAnccPsASNqkfs6GT5fgB8vZYcZ6gHgr2h";

describe("analytics configuration", () => {
  it("is disabled without a token and never throws", () => {
    expect(resolveAnalyticsConfig({})).toBeNull();
    expect(resolveAnalyticsConfig({ token: "  ", host: DEFAULT_POSTHOG_HOST })).toBeNull();
    expect(resolveAnalyticsConfig({ token: "not-a-project-token" })).toBeNull();
  });

  it("defaults to the US Cloud ingestion host", () => {
    expect(resolveAnalyticsConfig({ token: TOKEN })).toEqual({
      token: TOKEN,
      apiHost: "https://us.i.posthog.com",
    });
  });

  it("accepts only an https host and keeps just its origin", () => {
    expect(resolveAnalyticsConfig({ token: TOKEN, host: "https://eu.i.posthog.com/x?y" })).toEqual({
      token: TOKEN,
      apiHost: "https://eu.i.posthog.com",
    });
    expect(resolveAnalyticsConfig({ token: TOKEN, host: "http://us.i.posthog.com" })).toBeNull();
    expect(resolveAnalyticsConfig({ token: TOKEN, host: "not a url" })).toBeNull();
  });
});

describe("production host gate", () => {
  it("accepts exactly the public production host", () => {
    expect(isAnalyticsHost(ANALYTICS_PRODUCTION_HOSTNAME)).toBe(true);
    expect(isAnalyticsHost("RuneSpace.QCFailed.com")).toBe(true);
    expect(isAnalyticsHost("runespace.qcfailed.com:443")).toBe(true);
  });

  it.each([
    "localhost",
    "localhost:3000",
    "127.0.0.1:3200",
    "pr-413.runespace.qcfailed.com",
    "evil.runespace.qcfailed.com",
    "runespace.qcfailed.com.evil.example",
    "evilrunespace.qcfailed.com",
    "qcfailed.com",
    "user@runespace.qcfailed.com",
    "runespace.qcfailed.com/path",
    "",
  ])("rejects %s", (host) => {
    expect(isAnalyticsHost(host)).toBe(false);
  });

  it("rejects a missing host", () => {
    expect(isAnalyticsHost(null)).toBe(false);
    expect(isAnalyticsHost(undefined)).toBe(false);
  });
});

describe("privacy choices", () => {
  it("reads the opt-out cookie exactly", () => {
    expect(hasOptOutCookie("a=b; rs_analytics_optout=1; c=d")).toBe(true);
    expect(hasOptOutCookie("rs_analytics_optout=1")).toBe(true);
    expect(hasOptOutCookie("rs_analytics_optout=0")).toBe(false);
    expect(hasOptOutCookie("xrs_analytics_optout=1")).toBe(false);
    expect(hasOptOutCookie("")).toBe(false);
    expect(hasOptOutCookie(null)).toBe(false);
  });

  it("honors Global Privacy Control and Do Not Track", () => {
    expect(hasPrivacySignal({ globalPrivacyControl: true })).toBe(true);
    expect(hasPrivacySignal({ globalPrivacyControl: "1" })).toBe(true);
    expect(hasPrivacySignal({ doNotTrack: "1" })).toBe(true);
    expect(hasPrivacySignal({ doNotTrack: "yes" })).toBe(true);
    expect(hasPrivacySignal({ doNotTrack: "0" })).toBe(false);
    expect(hasPrivacySignal({ globalPrivacyControl: false, doNotTrack: null })).toBe(false);
    expect(hasPrivacySignal({})).toBe(false);
  });
});
