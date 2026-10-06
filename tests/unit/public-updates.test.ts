import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ITEM_IDS } from "@/game/config/foundations";
import {
  formatPublicUpdateDate,
  getLatestPublishedUpdate,
  getPublicUpdate,
  getPublicUpdatePath,
  getPublishedUpdates,
  validatePublicUpdates,
} from "@/features/public-site/public-updates";
import { getWikiArticle } from "@/features/public-site/public-wiki";

const baseUpdate = {
  slug: "first-update",
  title: "First Update",
  publishedAt: "2026-09-01T12:00:00Z",
  summary: "A short update.",
  body: ["A complete article paragraph."],
  patchNotes: [{ heading: "Added", items: ["A player-facing change."] }],
};

describe("public Updates content boundary", () => {
  it("sorts validated Updates newest-first by publishedAt", () => {
    const updates = validatePublicUpdates([
      baseUpdate,
      { ...baseUpdate, slug: "newer-update", publishedAt: "2026-09-03T12:00:00-07:00" },
    ]);

    expect(updates.map((update) => update.slug)).toEqual(["newer-update", "first-update"]);
  });

  it("rejects duplicate slugs", () => {
    expect(() =>
      validatePublicUpdates([baseUpdate, { ...baseUpdate, title: "Another title" }]),
    ).toThrow("Duplicate public Update slug: first-update");
  });

  it("rejects two Updates that publish at the same instant, even with different offsets", () => {
    expect(() =>
      validatePublicUpdates([
        baseUpdate,
        {
          ...baseUpdate,
          slug: "same-instant-update",
          // Same instant as baseUpdate's 2026-09-01T12:00:00Z, spelled with a
          // different UTC offset.
          publishedAt: "2026-09-01T05:00:00-07:00",
        },
      ]),
    ).toThrow("Duplicate public Update publishedAt instant");
  });

  it("requires an explicit ISO-8601 timezone or offset", () => {
    expect(() =>
      validatePublicUpdates([{ ...baseUpdate, publishedAt: "2026-09-01T12:00:00" }]),
    ).toThrow();
  });

  it("keeps optional hero images inside repository-owned public paths", () => {
    expect(() =>
      validatePublicUpdates([
        {
          ...baseUpdate,
          hero: {
            src: "/updates/../private.webp",
            alt: "Not a repository-owned image",
            width: 100,
            height: 100,
          },
        },
      ]),
    ).toThrow();
  });

  it("points every authored hero at a committed public file", () => {
    for (const update of getPublishedUpdates()) {
      if (!update.hero) continue;
      expect(
        existsSync(resolve(process.cwd(), "public", `.${update.hero.src}`)),
        `${update.slug} hero ${update.hero.src}`,
      ).toBe(true);
    }
  });

  it("ships the Holo Hollow town art as that release's hero", () => {
    expect(getPublicUpdate("holo-hollow-opens-for-business")?.hero).toMatchObject({
      src: "/location-scenes/holo-hollow.webp",
      width: 1536,
      height: 384,
    });
  });

  it("publishes the player-trading Update, linking the Player Trading Wiki page", () => {
    // Newer Updates have shipped since (#274), so it is found by slug.
    const trading = getPublicUpdate("meet-me-there")!;
    expect(Date.parse(trading.publishedAt)).toBeGreaterThan(
      Date.parse(getPublicUpdate("open-channels")!.publishedAt),
    );
    const links = trading.body
      .flatMap((paragraph) => (Array.isArray(paragraph) ? paragraph : []))
      .filter((segment) => typeof segment !== "string");
    expect(links).toContainEqual({ text: "Player Trading", articleSlug: "player-trading" });
    expect(getWikiArticle("player-trading")?.category).toBe("gear-and-credits");
  });

  it("publishes the recipe-unlock Update, linking both recipe Wiki pages", () => {
    // Newer Updates have shipped since (#261), so it is found by slug.
    const unlocks = getPublicUpdate("something-new-to-make")!;
    const links = unlocks.body
      .flatMap((paragraph) => (Array.isArray(paragraph) ? paragraph : []))
      .filter((segment) => typeof segment !== "string");
    expect(links).toContainEqual({ text: "Mining & Refining", articleSlug: "mining-and-refining" });
    expect(links).toContainEqual({
      text: "Fabrication & Tinkering",
      articleSlug: "fabrication-and-tinkering",
    });
  });

  it("publishes the Wheel Be Right Back Update as the newest, linking its Wiki pages", () => {
    // Newest by instant, so the account news boundary surfaces it (#156).
    const latest = getLatestPublishedUpdate();
    expect(latest.slug).toBe("wheel-be-right-back");
    expect(Date.parse(latest.publishedAt)).toBeGreaterThan(
      Date.parse(getPublicUpdate("turn-back")!.publishedAt),
    );
    // Never dated in the future: merging is the publication boundary.
    expect(Date.parse(latest.publishedAt)).toBeLessThanOrEqual(Date.now());
    // Player-facing: the job, the parts, the reward and the honest status.
    const text = JSON.stringify(latest);
    for (const label of [
      "Wheel Be Right Back",
      "Wade",
      "Wheel Assembly",
      "Fabrication 5",
      "250 Welding XP",
      "Landing gear restored. Propulsion offline.",
    ]) {
      expect(text).toContain(label);
    }
    expect(text).not.toMatch(/\bquests?\b/i);
    const links = latest.body
      .flatMap((paragraph) => (Array.isArray(paragraph) ? paragraph : []))
      .filter((segment) => typeof segment !== "string");
    expect(links).toContainEqual({ text: "Missions", articleSlug: "missions" });
    expect(links).toContainEqual({
      text: "Fabrication Station",
      articleSlug: "fabrication-and-tinkering",
    });
    // The item figure resolves from the canonical item registry, not a path.
    expect(latest.body[0]).toEqual({
      kind: "figure",
      art: { kind: "item", itemId: ITEM_IDS.wheelAssembly },
      side: "right",
    });
  });

  it("publishes the Turn Back Update, linking Travel & Scavenging", () => {
    // A newer Update has shipped since (#322), so it is found by slug.
    const latest = getPublicUpdate("turn-back")!;
    expect(latest.slug).toBe("turn-back");
    expect(Date.parse(latest.publishedAt)).toBeGreaterThan(
      Date.parse(getPublicUpdate("rare-finds")!.publishedAt),
    );
    // Never dated in the future: merging is the publication boundary.
    expect(Date.parse(latest.publishedAt)).toBeLessThanOrEqual(Date.now());
    // Player-facing: the button, the fare consequence and the Scavenge rule.
    const text = JSON.stringify(latest);
    for (const label of ["Turn Back", "isn't refunded", "Scavenge", "complete a walk"]) {
      expect(text).toContain(label);
    }
    const links = latest.body
      .flatMap((paragraph) => (Array.isArray(paragraph) ? paragraph : []))
      .filter((segment) => typeof segment !== "string");
    expect(links).toContainEqual({
      text: "Travel & Scavenging",
      articleSlug: "travel-and-scavenging",
    });
  });

  it("publishes the rare finds Update", () => {
    // A newer Update has shipped since (#312), so it is found by slug.
    const latest = getPublicUpdate("rare-finds")!;
    expect(Date.parse(latest.publishedAt)).toBeGreaterThan(
      Date.parse(getPublicUpdate("curly-must-stash")!.publishedAt),
    );
    // Never dated in the future: merging is the publication boundary.
    expect(Date.parse(latest.publishedAt)).toBeLessThanOrEqual(Date.now());
    // Player-facing: names the finds, the mark, the prices and the announcements,
    // and never the internal term or the authored odds.
    const text = JSON.stringify(latest);
    for (const label of [
      "Uncut Quartz",
      "Uncut Topaz",
      "Uncut Sapphire",
      "RARE FIND",
      "8 Credits",
      "18",
      "35",
      "System line",
    ]) {
      expect(text).toContain(label);
    }
    expect(text).not.toMatch(/secondary find/i);
    expect(text).not.toMatch(/\bquests?\b/i);
    const links = latest.body
      .flatMap((paragraph) => (Array.isArray(paragraph) ? paragraph : []))
      .filter((segment) => typeof segment !== "string");
    expect(links).toContainEqual({ text: "Mining & Refining", articleSlug: "mining-and-refining" });
  });

  it("publishes the Curly Must-Stash Update", () => {
    // A newer Update has shipped since (#308), so it is found by slug.
    const latest = getPublicUpdate("curly-must-stash")!;
    expect(latest.slug).toBe("curly-must-stash");
    expect(Date.parse(latest.publishedAt)).toBeGreaterThan(
      Date.parse(getPublicUpdate("a-stash-of-your-own")!.publishedAt),
    );
    // Never dated in the future: merging is the publication boundary.
    expect(Date.parse(latest.publishedAt)).toBeLessThanOrEqual(Date.now());
    const text = JSON.stringify(latest);
    for (const label of ["Curly", "HH B&B", "150 Credits", "Welding 1"]) {
      expect(text).toContain(label);
    }
    // His container is never presented as the player's storage.
    expect(text).toContain("isn't a stash for you");
    expect(text).not.toMatch(/\bquests?\b/i);
    const links = latest.body
      .flatMap((paragraph) => (Array.isArray(paragraph) ? paragraph : []))
      .filter((segment) => typeof segment !== "string");
    expect(links).toContainEqual({ text: "Curly", articleSlug: "curly" });
    expect(latest.hero?.src).toBe("/location-scenes/curly-room-after.webp");
  });

  it("publishes the site stash Update", () => {
    // A newer Update has shipped since (#292), so it is found by slug.
    const latest = getPublicUpdate("a-stash-of-your-own")!;
    expect(Date.parse(latest.publishedAt)).toBeGreaterThan(
      Date.parse(getPublicUpdate("room-to-spread-out")!.publishedAt),
    );
    // Never dated in the future: merging is the publication boundary.
    expect(Date.parse(latest.publishedAt)).toBeLessThanOrEqual(Date.now());
    // Player-facing: names only what a player sees, never the internal contract.
    const text = JSON.stringify(latest);
    for (const label of ["Container management", "Swap Container", "Remove Container", "Welding"]) {
      expect(text).toContain(label);
    }
    expect(text).not.toMatch(/\bquests?\b/i);
    const links = latest.body
      .flatMap((paragraph) => (Array.isArray(paragraph) ? paragraph : []))
      .filter((segment) => typeof segment !== "string");
    expect(links).toContainEqual({ text: "the Wiki", articleSlug: "cargo-hold-and-welding" });
  });

  it("publishes the desktop workspace Update", () => {
    // A newer Update has shipped since (#284), so it is found by slug.
    const update = getPublicUpdate("room-to-spread-out")!;
    expect(Date.parse(update.publishedAt)).toBeGreaterThan(
      Date.parse(getPublicUpdate("heads-up")!.publishedAt),
    );
    const text = JSON.stringify(update);
    for (const label of ["Chat", "Inventory", "Character", "Missions", "Set as default"]) {
      expect(text).toContain(label);
    }
    expect(text).not.toMatch(/\bquests?\b/i);
  });

  it("publishes the Chat/Social polish Update, linking Safety & Privacy", () => {
    // A newer Update has shipped since (#286), so it is found by slug.
    const latest = getPublicUpdate("heads-up")!;
    // Newer than the recipe-unlock Update, so the account news boundary surfaces it (#156).
    expect(Date.parse(latest.publishedAt)).toBeGreaterThan(
      Date.parse(getPublicUpdate("something-new-to-make")!.publishedAt),
    );
    const links = latest.body
      .flatMap((paragraph) => (Array.isArray(paragraph) ? paragraph : []))
      .filter((segment) => typeof segment !== "string");
    expect(links).toContainEqual({ text: "Safety & Privacy", articleSlug: "safety-and-privacy" });
  });

  it("uses one stable route projection for lookup and links", () => {
    const update = getLatestPublishedUpdate();

    expect(getPublicUpdate(update.slug)).toEqual(update);
    expect(getPublicUpdatePath(update)).toBe(`/updates/${update.slug}`);
    expect(getPublishedUpdates()[0]).toEqual(update);
  });

  it("formats the authored calendar date without shifting it through UTC", () => {
    expect(formatPublicUpdateDate("2026-09-08T23:30:00-07:00")).toBe("September 8, 2026");
    expect(formatPublicUpdateDate("2026-09-08T00:30:00+14:00")).toBe("September 8, 2026");
  });
});
