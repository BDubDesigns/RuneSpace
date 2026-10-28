import { describe, expect, it } from "vitest";
import {
  ANALYTICS_PRODUCTION_HOSTNAME,
  DEFAULT_POSTHOG_HOST,
  consentAllows,
  hasSignalCookie,
  readAnalyticsChoice,
  hasPrivacySignal,
  environmentProperties,
  isRuneSpaceHostname,
  parsePreviewPrs,
  resolveAnalyticsConfig,
  resolveAnalyticsEnvironment,
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
      previewPrs: [],
    });
  });

  it("accepts only an https host and keeps just its origin", () => {
    expect(resolveAnalyticsConfig({ token: TOKEN, host: "https://eu.i.posthog.com/x?y" })).toEqual({
      token: TOKEN,
      apiHost: "https://eu.i.posthog.com",
      previewPrs: [],
    });
    expect(resolveAnalyticsConfig({ token: TOKEN, host: "http://us.i.posthog.com" })).toBeNull();
    expect(resolveAnalyticsConfig({ token: TOKEN, host: "not a url" })).toBeNull();
  });
});

describe("preview allowlist parsing", () => {
  it("is empty (preview analytics off) by default", () => {
    expect(parsePreviewPrs(undefined)).toEqual([]);
    expect(parsePreviewPrs("")).toEqual([]);
    expect(parsePreviewPrs("   ")).toEqual([]);
    expect(resolveAnalyticsConfig({ token: TOKEN })?.previewPrs).toEqual([]);
  });

  it("accepts a comma-separated list of plain PR numbers", () => {
    expect(parsePreviewPrs("414")).toEqual([414]);
    expect(parsePreviewPrs(" 414 , 420,414 ")).toEqual([414, 420]);
    expect(resolveAnalyticsConfig({ token: TOKEN, previewPrs: "414" })?.previewPrs).toEqual([414]);
  });

  it.each(["true", "1,x", "414;420", "0", "0414", "-5", "4.5", "414,", ",414", "*", "all", "1e3"])(
    "rejects the whole value %j rather than partly honoring it",
    (raw) => {
      expect(parsePreviewPrs(raw)).toEqual([]);
    },
  );

  it("caps the list length", () => {
    const many = Array.from({ length: 21 }, (_, i) => i + 1).join(",");
    expect(parsePreviewPrs(many)).toEqual([]);
    expect(parsePreviewPrs(many.split(",").slice(0, 20).join(","))).toHaveLength(20);
  });
});

describe("analytics environment from the host", () => {
  it("accepts exactly the public production host", () => {
    const expected = { environment: "production", host: ANALYTICS_PRODUCTION_HOSTNAME };
    expect(resolveAnalyticsEnvironment(ANALYTICS_PRODUCTION_HOSTNAME)).toEqual(expected);
    expect(resolveAnalyticsEnvironment("RuneSpace.QCFailed.com")).toEqual(expected);
    expect(resolveAnalyticsEnvironment("runespace.qcfailed.com:443")).toEqual(expected);
    expect(resolveAnalyticsEnvironment("runespace.qcfailed.com.")).toEqual(expected);
  });

  it("never depends on the preview list for production", () => {
    for (const previewPrs of [[], [414], [1, 2, 3]]) {
      expect(resolveAnalyticsEnvironment("runespace.qcfailed.com", previewPrs)).toEqual({
        environment: "production",
        host: "runespace.qcfailed.com",
      });
    }
  });

  it("is off for every preview unless its PR is explicitly listed", () => {
    expect(resolveAnalyticsEnvironment("pr-414.runespace.qcfailed.com")).toBeNull();
    expect(resolveAnalyticsEnvironment("pr-414.runespace.qcfailed.com", [])).toBeNull();
    expect(resolveAnalyticsEnvironment("pr-414.runespace.qcfailed.com", [413, 415])).toBeNull();
  });

  it("is a labeled preview for a listed PR, with its number", () => {
    expect(resolveAnalyticsEnvironment("pr-414.runespace.qcfailed.com", [414])).toEqual({
      environment: "preview",
      host: "pr-414.runespace.qcfailed.com",
      pr: 414,
    });
    expect(resolveAnalyticsEnvironment("PR-414.runespace.qcfailed.com:443", [414])).toEqual({
      environment: "preview",
      host: "pr-414.runespace.qcfailed.com",
      pr: 414,
    });
    // Another listed PR does not enable this one.
    expect(resolveAnalyticsEnvironment("pr-415.runespace.qcfailed.com", [414])).toBeNull();
  });

  it.each([
    "localhost",
    "localhost:3000",
    "127.0.0.1:3200",
    "[::1]:3000",
    "pr-414.localhost",
    "pr-0414.runespace.qcfailed.com",
    "pr-.runespace.qcfailed.com",
    "pr-abc.runespace.qcfailed.com",
    "pr-414.pr-414.runespace.qcfailed.com",
    "pr-414.runespace.qcfailed.com.evil.example",
    "evil-pr-414.runespace.qcfailed.com",
    "pr-414.evil.qcfailed.com",
    "preview.runespace.qcfailed.com",
    "evil.runespace.qcfailed.com",
    "runespace.qcfailed.com.evil.example",
    "evilrunespace.qcfailed.com",
    "qcfailed.com",
    "user@runespace.qcfailed.com",
    "user@pr-414.runespace.qcfailed.com",
    "runespace.qcfailed.com/path",
    "pr-414.runespace.qcfailed.com/path",
    "pr-99999999.runespace.qcfailed.com",
    "",
  ])("never enables %j, even when preview PRs are listed", (host) => {
    expect(resolveAnalyticsEnvironment(host, [414, 99999999])).toBeNull();
  });

  it("rejects a missing host", () => {
    expect(resolveAnalyticsEnvironment(null, [414])).toBeNull();
    expect(resolveAnalyticsEnvironment(undefined, [414])).toBeNull();
  });

  it("recognizes RuneSpace's own hostnames for referral filtering", () => {
    expect(isRuneSpaceHostname("runespace.qcfailed.com")).toBe(true);
    expect(isRuneSpaceHostname("pr-414.runespace.qcfailed.com")).toBe(true);
    expect(isRuneSpaceHostname("example.org")).toBe(false);
  });

  it("states the environment (and PR) for every event", () => {
    expect(
      environmentProperties({ environment: "production", host: "runespace.qcfailed.com" }),
    ).toEqual({ environment: "production" });
    expect(
      environmentProperties({
        environment: "preview",
        host: "pr-414.runespace.qcfailed.com",
        pr: 414,
      }),
    ).toEqual({ environment: "preview", preview_pr: 414 });
  });
});

describe("privacy choices", () => {
  it("reads the saved choice cookie exactly", () => {
    expect(readAnalyticsChoice("a=b; rs_analytics_choice=on; c=d")).toBe("on");
    expect(readAnalyticsChoice("rs_analytics_choice=off")).toBe("off");
    expect(readAnalyticsChoice("rs_analytics_choice=1")).toBeUndefined();
    expect(readAnalyticsChoice("xrs_analytics_choice=on")).toBeUndefined();
    expect(readAnalyticsChoice("")).toBeUndefined();
    expect(readAnalyticsChoice(null)).toBeUndefined();
  });

  it("requires an explicit yes under opt-in (the shipped model)", () => {
    expect(consentAllows("on", "opt-in")).toBe(true);
    expect(consentAllows(undefined, "opt-in")).toBe(false);
    expect(consentAllows("off", "opt-in")).toBe(false);
    expect(consentAllows(undefined)).toBe(false);
  });

  it("only a stored no blocks under opt-out", () => {
    expect(consentAllows(undefined, "opt-out")).toBe(true);
    expect(consentAllows("on", "opt-out")).toBe(true);
    expect(consentAllows("off", "opt-out")).toBe(false);
  });

  it("reads the browser-maintained privacy-signal cookie", () => {
    expect(hasSignalCookie("a=b; rs_analytics_signal=1")).toBe(true);
    expect(hasSignalCookie("rs_analytics_signal=0")).toBe(false);
    expect(hasSignalCookie(null)).toBe(false);
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
