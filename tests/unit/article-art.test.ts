import { existsSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ITEM_IDS, NPC_IDS, EXPRESSION_IDS } from "@/game/config/foundations";
import { resolveArticleArt } from "@/game/content/article-art";
import * as itemPresentation from "@/game/content/item-presentation";
import { getNpc, resolveNpcExpression } from "@/game/content/npcs";
import { PublicLandingPage } from "@/features/public-site/PublicLandingPage";
import { PublicUpdatesPage } from "@/features/public-site/PublicUpdatesPage";
import { PublicUpdateBody } from "@/features/public-site/PublicUpdateBody";
import { getPublicUpdate, validatePublicUpdates } from "@/features/public-site/public-updates";
import type { PublicUpdateFigure } from "@/game/schemas/public-updates";

const itemFigure: PublicUpdateFigure = {
  kind: "figure",
  art: { kind: "item", itemId: ITEM_IDS.uncutTopaz },
  side: "right",
};
const npcFigure: PublicUpdateFigure = {
  kind: "figure",
  art: { kind: "npc", npcId: NPC_IDS.curly },
  side: "left",
};
const update = {
  slug: "figure-test",
  title: "Figures",
  publishedAt: "2026-10-01T12:00:00Z",
  summary: "An article.",
  body: [itemFigure, "Gem prose.", npcFigure, "Portrait prose."],
  patchNotes: [{ heading: "Added", items: ["Figures."] }],
};

afterEach(() => vi.restoreAllMocks());

describe("canonical article art", () => {
  it("resolves item presentation without duplicate art/name/alt", () => {
    const canonical = itemPresentation.getItemPresentation(ITEM_IDS.uncutTopaz)!;
    expect(resolveArticleArt(itemFigure.art)).toEqual({
      kind: "item",
      src: canonical.artworkSrc,
      displayName: canonical.displayName,
      accessibleDescription: canonical.accessibleDescription,
    });
    expect(getPublicUpdate("rare-finds")!.body[0]).toEqual(itemFigure);
  });

  it("resolves NPC identity and neutral/default or selected expression", () => {
    const npc = getNpc(NPC_IDS.curly)!;
    const neutral = resolveArticleArt(npcFigure.art);
    expect(neutral.src).toBe(resolveNpcExpression(npc.id, EXPRESSION_IDS.neutral));
    expect(neutral.displayName).toBe(npc.displayName);
    expect(neutral.accessibleDescription).toBe(
      `${npc.displayName}, ${npc.role}, neutral expression`,
    );
    for (const expressionId of Object.keys(npc.expressionAssets!)) {
      expect(
        resolveArticleArt({ ...npcFigure.art, kind: "npc", npcId: npc.id, expressionId }).src,
      ).toBe(resolveNpcExpression(npc.id, expressionId));
    }
  });

  it.each([
    { kind: "item", itemId: "unknown-item" },
    { kind: "npc", npcId: "unknown-npc" },
    { kind: "npc", npcId: NPC_IDS.curly, expressionId: "missing-expression" },
  ])("fails collection validation for invalid art %j", (art) => {
    expect(() => validatePublicUpdates([{ ...update, body: [{ ...itemFigure, art }] }])).toThrow();
  });

  it("rejects items without art rather than using a fallback", () => {
    vi.spyOn(itemPresentation, "getItemPresentation").mockReturnValue({
      displayName: "No art",
      accessibleDescription: "No art",
      textFallback: "NA",
    });
    expect(() => validatePublicUpdates([update])).toThrow("no canonical artwork");
  });

  it("rejects arbitrary sources, duplicated alt and invalid side/caption", () => {
    for (const invalid of [
      { ...itemFigure, src: "/item-art/uncut-topaz.webp" },
      { ...itemFigure, alt: "Duplicate description" },
      { ...itemFigure, art: { kind: "image", src: "https://example.com/image.png" } },
      { ...itemFigure, side: "center" },
      { ...itemFigure, caption: " " },
    ]) {
      expect(() => validatePublicUpdates([{ ...update, body: [invalid] }])).toThrow();
    }
  });

  it("keeps multiple figures and linked prose in body order, with default/override captions", () => {
    const body = validatePublicUpdates([
      {
        ...update,
        body: [
          itemFigure,
          ["See ", { text: "Mining", articleSlug: "mining-and-refining" }, "."],
          { ...npcFigure, caption: "A familiar guest" },
          "Portrait prose.",
        ],
      },
    ])[0]!.body;
    const markup = renderToStaticMarkup(React.createElement(PublicUpdateBody, { body }));
    expect(markup.match(/<figure /g)).toHaveLength(2);
    expect(markup).toContain("Uncut Topaz</figcaption>");
    expect(markup).toContain("A familiar guest</figcaption>");
    expect(markup).toContain('href="/wiki/mining-and-refining"');
    expect(markup.indexOf("Uncut Topaz</figcaption>")).toBeLessThan(markup.indexOf("See "));
    expect(markup.indexOf("A familiar guest</figcaption>")).toBeLessThan(
      markup.indexOf("Portrait prose."),
    );
    expect(markup).toContain(resolveArticleArt(npcFigure.art).accessibleDescription);
  });

  it("keeps index and homepage Latest Update summary-only", () => {
    const index = renderToStaticMarkup(React.createElement(PublicUpdatesPage));
    const landing = renderToStaticMarkup(
      React.createElement(PublicLandingPage, {
        signedIn: false,
        launch: {
          publicGameplayOpen: false,
          launchTargetAt: null,
          serverNow: "2026-10-01T12:00:00Z",
        },
      }),
    );
    // The index lists every Update; the homepage shows only the newest (#326).
    expect(index).toContain("Wheel Be Right Back");
    for (const markup of [index, landing]) {
      expect(markup).toContain("How to get it");
      expect(markup).not.toContain("rs-update-figure");
      expect(markup).not.toContain("uncut-topaz.webp");
      // Newer Updates open with an item figure of their own (#322, #326); like
      // any other, it is an article-only feature.
      expect(markup).not.toContain("wheel-assembly.webp");
    }
  });

  it("points all published figures at committed canonical files", () => {
    for (const art of [resolveArticleArt(itemFigure.art), resolveArticleArt(npcFigure.art)]) {
      expect(existsSync(resolve(process.cwd(), "public", `.${art.src}`))).toBe(true);
    }
  });
});
