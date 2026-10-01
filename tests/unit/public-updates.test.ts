import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
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
      src: "/updates/holo-hollow-town.webp",
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
      .flatMap((paragraph) => (typeof paragraph === "string" ? [] : paragraph))
      .filter((segment) => typeof segment !== "string");
    expect(links).toContainEqual({ text: "Player Trading", articleSlug: "player-trading" });
    expect(getWikiArticle("player-trading")?.category).toBe("gear-and-credits");
  });

  it("publishes the recipe-unlock Update as the newest, linking both recipe Wiki pages", () => {
    const latest = getLatestPublishedUpdate();
    expect(latest.slug).toBe("something-new-to-make");
    // Newest by instant, so the account news boundary surfaces it (#156).
    expect(Date.parse(latest.publishedAt)).toBeGreaterThan(
      Date.parse(getPublicUpdate("meet-me-there")!.publishedAt),
    );
    const links = latest.body
      .flatMap((paragraph) => (typeof paragraph === "string" ? [] : paragraph))
      .filter((segment) => typeof segment !== "string");
    expect(links).toContainEqual({ text: "Mining & Refining", articleSlug: "mining-and-refining" });
    expect(links).toContainEqual({
      text: "Fabrication & Tinkering",
      articleSlug: "fabrication-and-tinkering",
    });
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
