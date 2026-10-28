import { describe, expect, it } from "vitest";
import { buildPublicUpdateFeedHtml, wrapCdata } from "@/features/public-site/public-feed-html";
import { getPublishedUpdates } from "@/features/public-site/public-updates";
import { resolveArticleArt } from "@/game/content/article-art";
import type { PublicUpdate } from "@/game/schemas/public-updates";

const SITE_URL = "https://runespace.qcfailed.com";

const updates = getPublishedUpdates();
const heroUpdate = updates.find((update) => update.hero)!;
const figureUpdate = updates.find((update) =>
  update.body.some((block) => typeof block === "object" && !Array.isArray(block)),
)!;
const wikiUpdate = updates.find((update) =>
  update.body.some(
    (block) => Array.isArray(block) && block.some((segment) => typeof segment !== "string"),
  ),
)!;

function makeUpdate(overrides: Partial<PublicUpdate>): PublicUpdate {
  return {
    slug: "test-update",
    title: "Test Update",
    publishedAt: "2026-10-27T09:00:00-07:00",
    summary: "A test summary.",
    body: ["A test paragraph."],
    patchNotes: [{ heading: "General", items: ["A test patch note."] }],
    ...overrides,
  };
}

function escapeForTest(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

describe("buildPublicUpdateFeedHtml", () => {
  it("puts the hero image first, bare and absolute", () => {
    const html = buildPublicUpdateFeedHtml(heroUpdate, SITE_URL);
    const hero = heroUpdate.hero!;
    expect(html.startsWith(`<img src="${SITE_URL}${hero.src}"`)).toBe(true);
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("<p>"));
  });

  it("renders figures with resolved art, caption, and absolute src", () => {
    const figureBlock = figureUpdate.body.find(
      (block) => typeof block === "object" && !Array.isArray(block),
    );
    expect(figureBlock).toBeDefined();
    if (figureBlock && typeof figureBlock === "object" && !Array.isArray(figureBlock)) {
      const art = resolveArticleArt(figureBlock.art);
      const html = buildPublicUpdateFeedHtml(figureUpdate, SITE_URL);
      expect(html).toContain(`<img src="${SITE_URL}${art.src}"`);
      expect(html).toContain(
        `<figcaption>${escapeForTest(figureBlock.caption ?? art.displayName)}</figcaption>`,
      );
    }
  });

  it("renders Wiki link segments as absolute links", () => {
    const paragraph = wikiUpdate.body.find(
      (block) => Array.isArray(block) && block.some((segment) => typeof segment !== "string"),
    );
    expect(paragraph).toBeDefined();
    if (paragraph && Array.isArray(paragraph)) {
      const segment = paragraph.find((part) => typeof part !== "string");
      expect(segment).toBeDefined();
      if (segment && typeof segment !== "string") {
        const html = buildPublicUpdateFeedHtml(wikiUpdate, SITE_URL);
        expect(html).toContain(
          `<a href="${SITE_URL}/wiki/${segment.articleSlug}">${escapeForTest(segment.text)}</a>`,
        );
      }
    }
  });

  it("preserves load-bearing segment spaces and escapes link text", () => {
    const update = makeUpdate({
      body: [
        [
          "See ",
          { text: "Inventory & Equipment", articleSlug: "inventory-and-equipment" },
          " for how it works.",
        ],
      ],
    });
    expect(buildPublicUpdateFeedHtml(update, SITE_URL)).toContain(
      `See <a href="${SITE_URL}/wiki/inventory-and-equipment">Inventory &amp; Equipment</a> for how it works.`,
    );
  });

  it("renders patch notes after the body, in page order", () => {
    const html = buildPublicUpdateFeedHtml(heroUpdate, SITE_URL);
    const section = heroUpdate.patchNotes[0]!;
    expect(html.indexOf("<h2>Patch notes</h2>")).toBeGreaterThan(html.lastIndexOf("</p>"));
    expect(html).toContain(`<h3>${escapeForTest(section.heading)}</h3>`);
    expect(html).toContain(`<li>${escapeForTest(section.items[0]!)}</li>`);
  });

  it("escapes text and attribute values", () => {
    const update = makeUpdate({
      body: ['A <b>bold</b> claim & a "quoted" one.'],
      patchNotes: [{ heading: "General", items: ['Fixes "things" & <stuff>.'] }],
      hero: { src: "/updates/test-hero.webp", alt: 'A "hero" & <image>', width: 100, height: 50 },
    });
    const html = buildPublicUpdateFeedHtml(update, SITE_URL);
    // Text nodes escape &, <, >; a double quote in text needs no escaping.
    expect(html).toContain('A &lt;b&gt;bold&lt;/b&gt; claim &amp; a "quoted" one.');
    expect(html).toContain('alt="A &quot;hero&quot; &amp; &lt;image&gt;"');
    expect(html).toContain('<li>Fixes "things" &amp; &lt;stuff&gt;.</li>');
    expect(html).not.toContain("<b>bold</b>");
  });

  it("uses only allowlisted tags and no classes, styles, scripts, or handlers", () => {
    const allowed = new Set(["img", "figure", "figcaption", "p", "a", "h2", "h3", "ul", "li"]);
    for (const update of [heroUpdate, figureUpdate, wikiUpdate]) {
      const html = buildPublicUpdateFeedHtml(update, SITE_URL);
      for (const match of html.matchAll(/<([a-z0-9]+)/g)) {
        expect(allowed.has(match[1]!)).toBe(true);
      }
      expect(html).not.toMatch(/class=|style=|<script|<iframe|<embed|<object|\son\w+=/);
    }
  });

  it("emits only absolute href and src values", () => {
    for (const update of [heroUpdate, figureUpdate, wikiUpdate]) {
      const html = buildPublicUpdateFeedHtml(update, SITE_URL);
      expect(html).not.toContain('href="/');
      expect(html).not.toContain('src="/');
      for (const match of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
        expect(match[1]!.startsWith(SITE_URL)).toBe(true);
      }
    }
  });
});

describe("wrapCdata", () => {
  it("rejoins split sections to the original HTML", () => {
    const original = "<p>A paragraph with ]]> inside it.</p>";
    const wrapped = wrapCdata(original);
    const rejoined = [...wrapped.matchAll(/<!\[CDATA\[(.*?)\]\]>/gs)]
      .map((match) => match[1])
      .join("");
    expect(rejoined).toBe(original);
  });
});
