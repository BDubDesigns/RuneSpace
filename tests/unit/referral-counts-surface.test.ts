// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const record = vi.hoisted(() => ({ recordReferralVisit: vi.fn(async () => undefined) }));
vi.mock("@/server/referral-counts", () => record);

import { AnalyticsConsentPrompt } from "@/features/analytics/AnalyticsConsentPrompt";
import { VisitCountControl } from "@/features/analytics/VisitCountControl";
import { SAFETY_PRIVACY_PATH } from "@/features/public-site/policy-links";
import { wikiArticles } from "@/features/public-site/public-wiki";
import { config, middleware } from "@/middleware";
import { POST } from "@/app/api/visit-count-preference/route";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextRequest as Request } from "next/server";

function text(markup: string) {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

describe("consent banner copy", () => {
  const markup = renderToStaticMarkup(React.createElement(AnalyticsConsentPrompt));

  it("is the warm, human invitation with two equally easy choices", () => {
    const body = text(markup);
    expect(body).toContain("Help a solo dev make RuneSpace better?");
    expect(body).toContain("while working a full-time job");
    expect(body).toContain("my partner and daughter");
    expect(body).toContain("saying no is fine");
    const buttons = [...markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)];
    expect(buttons.map((b) => b[2])).toEqual(["Help me improve RuneSpace", "No thanks"]);
    // Same weight and effort: identical styling, no dark pattern.
    expect(buttons[0]![1]).toBe(buttons[1]![1]);
  });

  it("is truthful that visit counts are separate and only PostHog waits for a choice", () => {
    const body = text(markup);
    expect(body).toContain("counts basic page visits and where they came from in daily totals");
    expect(body).toContain("without following individual visitors");
    expect(body).toContain("optional PostHog analytics");
    expect(body).toContain("Until you choose, nothing goes to PostHog");
    // It must never claim that all analytics is off, or promise an outcome.
    expect(body).not.toMatch(/nothing is stored or sent/i);
    expect(body).not.toMatch(/analytics is off/i);
    expect(body).not.toMatch(/guarantee|promise|you owe|please help|only way/i);
  });

  it("links to the visit-count settings on Safety & Privacy", () => {
    expect(markup).toContain(`href="${SAFETY_PRIVACY_PATH}#visit-count-settings"`);
    expect(text(markup)).toContain("Privacy & visit-count settings");
  });

  it("stays out of the Play screen", () => {
    nav.pathname = "/play/abc";
    expect(renderToStaticMarkup(React.createElement(AnalyticsConsentPrompt))).toBe("");
    nav.pathname = "/";
  });
});

describe("visit-count control markup", () => {
  it("is a real form that works without JavaScript and offers the undo in <noscript>", () => {
    const markup = renderToStaticMarkup(React.createElement(VisitCountControl));
    expect(markup).toContain('id="visit-count-settings"');
    expect(markup).toContain('action="/api/visit-count-preference"');
    expect(markup).toContain('method="post"');
    expect(markup).toContain('<input type="hidden" name="choice" value="off"/>');
    expect(markup).toContain("Do not count my visits");
    expect(markup).toMatch(/<noscript>.*value="on".*Count my visits again.*<\/noscript>/);
    expect(text(markup)).toContain("separate from the PostHog choice");
  });

  it("makes no claim about the saved choice before it can read it (no JS, static page)", () => {
    const body = text(renderToStaticMarkup(React.createElement(VisitCountControl)));
    expect(body).toContain("can't see your saved choice");
    expect(body).not.toMatch(/are included|aren't counted|won't be\./);
  });
});

describe("Safety & Privacy copy", () => {
  const article = wikiArticles.find((entry) => entry.slug === "safety-and-privacy")!;
  const everything = JSON.stringify(article);

  it("discloses the separate anonymous counts, their limits, and the objection", () => {
    const section = article.sections.find((s) => s.heading === "Anonymous visit counts")!;
    const body = JSON.stringify(section);
    for (const phrase of [
      "whether or not you say yes to PostHog",
      "page loads, not people",
      "25 months",
      "Global Privacy Control or Do Not Track",
      "Do not count my visits",
      "doesn't keep your IP address",
      "the first page you open can be counted",
    ]) {
      expect(body, phrase).toContain(phrase);
    }
  });

  it("never claims all analytics is off, or that nothing is counted before a choice", () => {
    expect(everything).not.toMatch(/Analytics is off until you say yes/);
    expect(everything).toContain(
      "Saying no to PostHog doesn't turn off the anonymous visit counts",
    );
    expect(everything).toContain("PostHog analytics is off until you say yes");
  });
});

describe("middleware", () => {
  const countable = {
    host: "runespace.qcfailed.com",
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    accept: "text/html",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
  };
  function run(url: string, headers: Record<string, string>) {
    const waited: Promise<unknown>[] = [];
    const response = middleware(
      new Request(url, { headers }) as unknown as NextRequest,
      {
        waitUntil: (promise: Promise<unknown>) => waited.push(promise),
      } as unknown as NextFetchEvent,
    );
    return { response, waited };
  }

  beforeEach(() => record.recordReferralVisit.mockClear());

  it("hands a countable request to the counter off the response path", () => {
    const { response, waited } = run(
      "https://runespace.qcfailed.com/wiki?utm_source=Reddit",
      countable,
    );
    expect(response.status).toBe(200);
    expect(record.recordReferralVisit).toHaveBeenCalledTimes(1);
    expect(record.recordReferralVisit).toHaveBeenCalledWith({
      sourceGroup: "reddit",
      utmSource: "reddit",
      utmMedium: "",
      utmCampaign: "",
      routeCategory: "wiki",
    });
    expect(waited).toHaveLength(1);
  });

  it("does nothing for an uncountable request, and never changes the response", () => {
    const { response, waited } = run("https://runespace.qcfailed.com/wiki", {
      ...countable,
      "sec-gpc": "1",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(record.recordReferralVisit).not.toHaveBeenCalled();
    expect(waited).toHaveLength(0);
  });

  it("survives a counter that throws synchronously", () => {
    record.recordReferralVisit.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(run("https://runespace.qcfailed.com/", countable).response.status).toBe(200);
  });

  it("runs on the Node.js runtime and only for the public routes that can be counted", () => {
    expect(config.runtime).toBe("nodejs");
    const matchers = config.matcher.map(
      (pattern) => new RegExp(`^${pattern.replace("/:path*", "(?:/.*)?")}$`),
    );
    const matches = (path: string) => matchers.some((matcher) => matcher.test(path));
    for (const path of [
      "/",
      "/updates",
      "/updates/a-post",
      "/wiki",
      "/wiki/items/slug",
      "/high-scores",
      "/high-scores/characters/Abc",
      "/register",
      "/sign-in",
    ]) {
      expect(matches(path), path).toBe(true);
    }
    for (const path of [
      "/play/x",
      "/characters",
      "/admin",
      "/api/build-info",
      "/_next/static/a.js",
      "/feed.xml",
    ]) {
      expect(matches(path), path).toBe(false);
    }
  });
});

describe("visit-count preference route", () => {
  function post(body: string, headers: Record<string, string> = {}) {
    return POST(
      new Request("https://runespace.qcfailed.com/api/visit-count-preference", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "sec-fetch-site": "same-origin",
          ...headers,
        },
        body,
      }),
    );
  }

  it("records the objection with a long-lived first-party cookie and a confirmation page", async () => {
    const response = await post("choice=off");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBe(
      "rs_stats_optout=1; Max-Age=31536000; Path=/; SameSite=Lax; Secure",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain("won't count your visits");
    expect(html).toContain(`href="${SAFETY_PRIVACY_PATH}#visit-count-settings"`);
  });

  it("clears it again, and never touches the PostHog cookies", async () => {
    const response = await post("choice=on", { "x-forwarded-proto": "https" });
    expect(response.headers.get("set-cookie")).toBe(
      "rs_stats_optout=; Max-Age=0; Path=/; SameSite=Lax; Secure",
    );
    expect(response.headers.get("set-cookie")).not.toMatch(/analytics/);
  });

  it("refuses cross-site posts, so another site cannot clear or set an objection", async () => {
    const forged: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
      { "sec-fetch-site": "same-site", origin: "https://evil.runespace.qcfailed.com" },
      { "sec-fetch-site": "none" },
      { "sec-fetch-site": "", origin: "https://evil.example", host: "runespace.qcfailed.com" },
      { "sec-fetch-site": "", origin: "null", host: "runespace.qcfailed.com" },
      { "sec-fetch-site": "" },
    ];
    for (const headers of forged) {
      for (const body of ["choice=on", "choice=off"]) {
        const response = await post(body, headers);
        expect(response.status, JSON.stringify(headers)).toBe(403);
        expect(response.headers.get("set-cookie")).toBeNull();
      }
    }
  });

  it("accepts the site's own form, by Fetch Metadata or by a matching Origin", async () => {
    expect((await post("choice=on")).status).toBe(200);
    const byOrigin = await post("choice=off", {
      "sec-fetch-site": "",
      origin: "https://runespace.qcfailed.com",
      host: "runespace.qcfailed.com",
    });
    expect(byOrigin.status).toBe(200);
    const proxied = await post("choice=off", {
      "sec-fetch-site": "",
      origin: "https://runespace.qcfailed.com",
      host: "10.0.0.2:3000",
      "x-forwarded-host": "runespace.qcfailed.com",
    });
    expect(proxied.status).toBe(200);
  });

  it("rejects anything else without setting a cookie or echoing input", async () => {
    for (const body of ["", "choice=maybe", "choice=<script>alert(1)</script>", "other=off"]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).not.toContain("script");
    }
  });
});
