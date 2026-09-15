import { describe, expect, it } from "vitest";
import {
  assertWikiCategoriesArePopulated,
  getWikiArticle,
  getWikiArticleGroups,
  getWikiArticlePath,
  getWikiArticles,
  validatePublicWikiArticles,
} from "@/features/public-site/public-wiki";
import { WIKI_CATEGORIES } from "@/game/schemas/public-wiki";

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
        .filter((article) => article.category === group.id)
        .map((article) => article.slug);
      expect(group.articles.map((article) => article.slug)).toEqual(authoredOrder);
    }
  });

  it("groups every article exactly once, losing none", () => {
    const grouped = getWikiArticleGroups().flatMap((group) => group.articles.map((a) => a.slug));

    expect([...grouped].sort()).toEqual([...getWikiArticles().map((a) => a.slug)].sort());
  });

  it("gives every named NPC a character article under People", () => {
    const people = getWikiArticleGroups().find((group) => group.id === "people");

    expect(people?.articles.map((article) => article.slug)).toEqual([
      "wade-rusk",
      "tansy-rusk",
      "bix-weller",
      "renn-calder",
      "mara-kells",
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
