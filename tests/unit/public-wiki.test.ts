import { describe, expect, it } from "vitest";
import {
  getWikiArticle,
  getWikiArticlePath,
  getWikiArticles,
  validatePublicWikiArticles,
} from "@/features/public-site/public-wiki";

const baseArticle = {
  slug: "first-article",
  title: "First Article",
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
});
