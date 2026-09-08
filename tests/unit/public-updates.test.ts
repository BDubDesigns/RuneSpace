import { describe, expect, it } from "vitest";
import {
  getLatestPublishedUpdate,
  getPublicUpdate,
  getPublicUpdatePath,
  getPublishedUpdates,
  validatePublicUpdates,
} from "@/features/public-site/public-updates";

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

  it("uses one stable route projection for lookup and links", () => {
    const update = getLatestPublishedUpdate();

    expect(getPublicUpdate(update.slug)).toEqual(update);
    expect(getPublicUpdatePath(update)).toBe(`/updates/${update.slug}`);
    expect(getPublishedUpdates()[0]).toEqual(update);
  });
});
