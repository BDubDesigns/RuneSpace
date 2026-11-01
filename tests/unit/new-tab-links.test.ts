import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicNavigation, opensInNewTab } from "@/components/public-site/PublicNavigation";
import { publicSiteNavigation } from "@/features/public-site/public-site-content";

/** Issue #448 — Wiki, High Scores and Updates entry links open in a new tab. */
describe("public navigation new-tab links", () => {
  const html = renderToStaticMarkup(
    React.createElement(PublicNavigation, { items: publicSiteNavigation }),
  );
  const anchors = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);

  it("opens only Updates, Wiki and High Scores in a new tab", () => {
    for (const item of publicSiteNavigation) {
      expect(opensInNewTab(item.href)).toBe(item.href !== "/");
    }
  });

  it("gives each new-tab link target=_blank with rel=noopener, and leaves Home alone", () => {
    for (const href of ["/updates", "/wiki", "/high-scores"]) {
      const tagged = anchors.filter((a) => a.includes(`href="${href}"`));
      expect(tagged.length).toBeGreaterThan(0);
      for (const a of tagged) {
        expect(a).toContain('target="_blank"');
        expect(a).toContain('rel="noopener"');
      }
    }
    const home = anchors.filter((a) => a.includes('href="/"'));
    expect(home.length).toBeGreaterThan(0);
    for (const a of home) expect(a).not.toContain("target=");
  });
});
