import { describe, expect, it } from "vitest";
import {
  assertWikiCategoriesArePopulated,
  getWikiArticle,
  getWikiArticleGroups,
  getWikiArticlePath,
  getWikiArticles,
  getWikiStartHereArticle,
  isWikiArticleIndexed,
  validatePublicWikiArticles,
  WIKI_START_HERE_SLUG,
  type WikiArticle,
} from "@/features/public-site/public-wiki";
import { MISSIONS } from "@/game/content/missions";
import { WIKI_CATEGORIES } from "@/game/schemas/public-wiki";

/** The permanent slug of each shipped Mission's guide, keyed by Mission title (#339). */
const MISSION_GUIDE_SLUGS = {
  "Walk It Off": "mission-walk-it-off",
  "Cut Your Teeth": "mission-cut-your-teeth",
  "Waste Not": "mission-waste-not",
  "Hold It Together": "mission-hold-it-together",
  "Keep the Change": "mission-keep-the-change",
  "10,000 Hours": "mission-10000-hours",
  "10,001 Hours": "mission-10001-hours",
  "Return the Favor": "mission-return-the-favor",
  "Break It Down": "mission-break-it-down",
  "Brace Yourself": "mission-brace-yourself",
  "Wheel Be Right Back": "mission-wheel-be-right-back",
  "Thrust Issues": "mission-thrust-issues",
  "A Cut Above": "mission-a-cut-above",
  "Out of the Weather": "mission-out-of-the-weather",
  "Cutting Costs": "mission-cutting-costs",
  "Curly Must-Stash": "mission-curly-must-stash",
} as const;

const missionGuideSlugs: readonly string[] = Object.values(MISSION_GUIDE_SLUGS);

/** Every authored link segment in an article, in reading order. */
function linkSegments(article: WikiArticle) {
  const segments: { text: string; articleSlug: string }[] = [];
  for (const section of article.sections) {
    for (const entry of [...(section.paragraphs ?? []), ...(section.list ?? [])]) {
      if (typeof entry === "string") continue;
      for (const segment of entry) {
        if (typeof segment !== "string") segments.push(segment);
      }
    }
  }
  return segments;
}

const baseArticle = {
  slug: "first-article",
  title: "First Article",
  category: "getting-started" as const,
  summary: "A short summary.",
  sections: [{ paragraphs: ["A complete paragraph."] }],
};

describe("public Wiki content boundary", () => {
  it("keeps articles in authored order rather than sorting them", () => {
    const articles = validatePublicWikiArticles([
      baseArticle,
      { ...baseArticle, slug: "second-article", title: "Second Article" },
    ]);

    expect(articles.map((article) => article.slug)).toEqual(["first-article", "second-article"]);
  });

  it("rejects duplicate slugs", () => {
    expect(() =>
      validatePublicWikiArticles([baseArticle, { ...baseArticle, title: "Another title" }]),
    ).toThrow("Duplicate Wiki article slug: first-article");
  });

  it("rejects an article with no sections", () => {
    expect(() => validatePublicWikiArticles([{ ...baseArticle, sections: [] }])).toThrow();
  });

  it("rejects a section with neither paragraphs nor a list", () => {
    expect(() =>
      validatePublicWikiArticles([{ ...baseArticle, sections: [{ heading: "Empty" }] }]),
    ).toThrow();
  });

  it("accepts a list-only section with no paragraphs", () => {
    const [article] = validatePublicWikiArticles([
      { ...baseArticle, sections: [{ heading: "A heading", list: ["One item"] }] },
    ]);

    expect(article!.sections[0]).toEqual({ heading: "A heading", list: ["One item"] });
  });

  it("accepts an optional heading and list on a section", () => {
    const [article] = validatePublicWikiArticles([
      {
        ...baseArticle,
        sections: [
          { heading: "A heading", paragraphs: ["Some prose."], list: ["One item", "Two items"] },
        ],
      },
    ]);

    expect(article!.sections[0]).toEqual({
      heading: "A heading",
      paragraphs: ["Some prose."],
      list: ["One item", "Two items"],
    });
  });

  it("uses one stable route projection for lookup and links", () => {
    const [article] = getWikiArticles();

    expect(getWikiArticle(article!.slug)).toEqual(article);
    expect(getWikiArticlePath(article!)).toBe(`/wiki/${article!.slug}`);
  });

  it("returns undefined for an unknown slug", () => {
    expect(getWikiArticle("not-a-real-article")).toBeUndefined();
  });

  it("accepts a paragraph with a deliberate link segment to a real article", () => {
    const articles = validatePublicWikiArticles([
      baseArticle,
      {
        ...baseArticle,
        slug: "second-article",
        title: "Second Article",
        sections: [
          {
            paragraphs: [["See ", { text: "First Article", articleSlug: "first-article" }, "."]],
          },
        ],
      },
    ]);

    expect(articles[1]!.sections[0]!.paragraphs).toEqual([
      ["See ", { text: "First Article", articleSlug: "first-article" }, "."],
    ]);
  });

  it("rejects a link segment whose target does not resolve to a real article slug", () => {
    expect(() =>
      validatePublicWikiArticles([
        {
          ...baseArticle,
          sections: [
            {
              paragraphs: [["See ", { text: "Nowhere", articleSlug: "not-a-real-article" }, "."]],
            },
          ],
        },
      ]),
    ).toThrow('Wiki article "first-article" links to unknown article slug: not-a-real-article');
  });

  it("accepts a list item with a deliberate link segment to a real article", () => {
    const articles = validatePublicWikiArticles([
      baseArticle,
      {
        ...baseArticle,
        slug: "second-article",
        title: "Second Article",
        sections: [
          {
            list: [["See ", { text: "First Article", articleSlug: "first-article" }, "."]],
          },
        ],
      },
    ]);

    expect(articles[1]!.sections[0]!.list).toEqual([
      ["See ", { text: "First Article", articleSlug: "first-article" }, "."],
    ]);
  });

  it("rejects a list-item link segment whose target does not resolve to a real article slug", () => {
    expect(() =>
      validatePublicWikiArticles([
        {
          ...baseArticle,
          sections: [
            {
              list: [["See ", { text: "Nowhere", articleSlug: "not-a-real-article" }, "."]],
            },
          ],
        },
      ]),
    ).toThrow('Wiki article "first-article" links to unknown article slug: not-a-real-article');
  });

  it("requires a category on every article", () => {
    const { category: _category, ...withoutCategory } = baseArticle;

    expect(() => validatePublicWikiArticles([withoutCategory])).toThrow();
  });

  it("rejects a category outside the declared set", () => {
    expect(() =>
      validatePublicWikiArticles([{ ...baseArticle, category: "lore-and-legends" }]),
    ).toThrow();
  });

  it("rejects a declared category that no article is filed under", () => {
    expect(() =>
      assertWikiCategoriesArePopulated(validatePublicWikiArticles([baseArticle])),
    ).toThrow(/^Wiki category has no articles: /);
  });

  it("files every real article under a declared category, leaving none empty", () => {
    expect(() => assertWikiCategoriesArePopulated(getWikiArticles())).not.toThrow();
  });

  it("groups the index by category in declared order, preserving authored order within each", () => {
    const groups = getWikiArticleGroups();

    expect(groups.map((group) => group.id)).toEqual(WIKI_CATEGORIES.map((category) => category.id));

    for (const group of groups) {
      expect(group.articles.length).toBeGreaterThan(0);

      const authoredOrder = getWikiArticles()
        .filter((article) => article.category === group.id && isWikiArticleIndexed(article))
        .map((article) => article.slug);
      expect(group.articles.map((article) => article.slug)).toEqual(authoredOrder);
    }
  });

  it("groups every index-visible article exactly once, losing none", () => {
    const grouped = getWikiArticleGroups().flatMap((group) => group.articles.map((a) => a.slug));
    const indexed = getWikiArticles()
      .filter((article) => isWikiArticleIndexed(article))
      .map((a) => a.slug);

    expect([...grouped].sort()).toEqual([...indexed].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("shows an article in the index unless it opts out with showInIndex: false", () => {
    const [visible, explicitlyVisible, hidden] = validatePublicWikiArticles([
      baseArticle,
      { ...baseArticle, slug: "explicit", showInIndex: true },
      { ...baseArticle, slug: "hidden", showInIndex: false },
    ]);

    expect(isWikiArticleIndexed(visible!)).toBe(true);
    expect(isWikiArticleIndexed(explicitlyVisible!)).toBe(true);
    expect(isWikiArticleIndexed(hidden!)).toBe(false);
  });

  it("rejects a non-boolean showInIndex", () => {
    expect(() => validatePublicWikiArticles([{ ...baseArticle, showInIndex: "no" }])).toThrow();
  });

  it("still validates links from an index-hidden article", () => {
    expect(() =>
      validatePublicWikiArticles([
        baseArticle,
        {
          ...baseArticle,
          slug: "hidden",
          showInIndex: false,
          sections: [{ paragraphs: [["See ", { text: "Nowhere", articleSlug: "not-real" }, "."]] }],
        },
      ]),
    ).toThrow('Wiki article "hidden" links to unknown article slug: not-real');
  });

  it("keeps an index-hidden article linkable from other articles", () => {
    const articles = validatePublicWikiArticles([
      { ...baseArticle, showInIndex: false },
      {
        ...baseArticle,
        slug: "second-article",
        sections: [
          { paragraphs: [["See ", { text: "First", articleSlug: "first-article" }, "."]] },
        ],
      },
    ]);

    expect(articles).toHaveLength(2);
  });

  it("does not let a category made only of index-hidden articles pass as populated", () => {
    expect(() =>
      assertWikiCategoriesArePopulated(
        validatePublicWikiArticles([{ ...baseArticle, showInIndex: false }]),
      ),
    ).toThrow(/^Wiki category has no articles: /);
  });

  it("resolves the index's start-here spotlight to a real authored article", () => {
    const startHere = getWikiStartHereArticle();

    expect(startHere.slug).toBe(WIKI_START_HERE_SLUG);
    expect(getWikiArticle(WIKI_START_HERE_SLUG)).toEqual(startHere);
  });

  it("keeps the spotlighted article inside its own category rather than removing it", () => {
    const startHere = getWikiStartHereArticle();
    const group = getWikiArticleGroups().find((g) => g.id === startHere.category);

    expect(group?.articles.map((article) => article.slug)).toContain(startHere.slug);
  });

  it("gives every category a player-facing description for the index panels", () => {
    for (const group of getWikiArticleGroups()) {
      expect(group.description.trim().length).toBeGreaterThan(0);
      expect(group.description).not.toBe(group.label);
    }
  });

  it("gives every named NPC a character article under People", () => {
    const people = getWikiArticleGroups().find((group) => group.id === "people");

    expect(people?.articles.map((article) => article.slug)).toEqual([
      "wade-rusk",
      "tansy-rusk",
      "bix-weller",
      "renn-calder",
      "mara-kells",
      "curly",
    ]);
  });

  it("resolves the real Wiki collection's authored internal links (paragraphs and lists) to known articles", () => {
    const knownSlugs = new Set(getWikiArticles().map((article) => article.slug));

    for (const article of getWikiArticles()) {
      for (const section of article.sections) {
        for (const entry of [...(section.paragraphs ?? []), ...(section.list ?? [])]) {
          if (typeof entry === "string") continue;
          for (const segment of entry) {
            if (typeof segment === "string") continue;
            expect(knownSlugs.has(segment.articleSlug)).toBe(true);
          }
        }
      }
    }
  });
});

describe("Mission guides (#339)", () => {
  const hub = () => getWikiArticle("missions")!;

  it("has exactly one guide per shipped Mission, and no guide without one", () => {
    expect(MISSIONS.map((mission) => mission.title).sort()).toEqual(
      Object.keys(MISSION_GUIDE_SLUGS).sort(),
    );
    expect(missionGuideSlugs).toHaveLength(16);
    expect(new Set(missionGuideSlugs).size).toBe(16);

    for (const [title, slug] of Object.entries(MISSION_GUIDE_SLUGS)) {
      const guide = getWikiArticle(slug);
      expect(guide, slug).toBeDefined();
      expect(guide!.title).toBe(title);
      expect(guide!.category).toBe("getting-started");
      expect(getWikiArticlePath(guide!)).toBe(`/wiki/${slug}`);
    }
  });

  it("keeps every guide routable but out of the index panels", () => {
    const indexed = getWikiArticleGroups().flatMap((group) => group.articles.map((a) => a.slug));

    for (const slug of missionGuideSlugs) {
      expect(getWikiArticles().some((article) => article.slug === slug)).toBe(true);
      expect(isWikiArticleIndexed(getWikiArticle(slug)!)).toBe(false);
      expect(indexed).not.toContain(slug);
    }
  });

  it("lists the Missions hub exactly once, under Getting Started", () => {
    const groups = getWikiArticleGroups();
    const listings = groups.flatMap((group) =>
      group.articles.filter((article) => article.slug === "missions").map(() => group.id),
    );

    expect(listings).toEqual(["getting-started"]);
    expect(isWikiArticleIndexed(hub())).toBe(true);
  });

  it("links each of the 16 guides from the hub exactly once", () => {
    const hubTargets = linkSegments(hub()).map((segment) => segment.articleSlug);

    for (const slug of missionGuideSlugs) {
      expect(
        hubTargets.filter((target) => target === slug),
        slug,
      ).toHaveLength(1);
    }
  });

  it("links each guide's hub link text to the guide titled by that text", () => {
    for (const segment of linkSegments(hub())) {
      const expected = MISSION_GUIDE_SLUGS[segment.text as keyof typeof MISSION_GUIDE_SLUGS];
      if (expected) expect(segment.articleSlug).toBe(expected);
    }
  });

  it("links every guide back to the Missions hub", () => {
    for (const slug of missionGuideSlugs) {
      const targets = linkSegments(getWikiArticle(slug)!).map((segment) => segment.articleSlug);
      expect(targets, slug).toContain("missions");
    }
  });

  it("links every guide to the guide of the Mission it follows", () => {
    for (const mission of MISSIONS) {
      if (!mission.prerequisiteMissionId) continue;
      const prerequisite = MISSIONS.find((other) => other.id === mission.prerequisiteMissionId)!;
      const guide = getWikiArticle(
        MISSION_GUIDE_SLUGS[mission.title as keyof typeof MISSION_GUIDE_SLUGS],
      )!;
      const targets = linkSegments(guide).map((segment) => segment.articleSlug);

      expect(targets, `${mission.title} -> ${prerequisite.title}`).toContain(
        MISSION_GUIDE_SLUGS[prerequisite.title as keyof typeof MISSION_GUIDE_SLUGS],
      );
    }
  });

  it("points every link that names a specific Mission at that Mission's guide, not the hub", () => {
    for (const article of getWikiArticles()) {
      for (const segment of linkSegments(article)) {
        const guideSlug = MISSION_GUIDE_SLUGS[segment.text as keyof typeof MISSION_GUIDE_SLUGS];
        if (guideSlug) {
          expect(segment.articleSlug, `${article.slug}: "${segment.text}"`).toBe(guideSlug);
        }
      }
    }
  });

  it("keeps general Mission Log help on the hub instead of repeating it in every guide", () => {
    for (const slug of missionGuideSlugs) {
      const headings = getWikiArticle(slug)!.sections.map((section) => section.heading);
      expect(headings, slug).not.toContain("Following Mission Objectives");
      expect(headings, slug).not.toContain("Pinning Missions");
      expect(headings, slug).not.toContain("Talking to people");
    }
  });
});
