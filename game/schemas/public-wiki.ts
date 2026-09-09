import { z } from "zod";

const wikiSlug = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Wiki article slugs must be lowercase kebab-case for stable public routes",
  );

const wikiText = z.string().trim().min(1);

/**
 * An authored, explicit link from a phrase to another Wiki article. Authors
 * choose exactly which phrase links where — this is never automatic keyword
 * replacement/autolinking. `articleSlug` is checked against the real
 * authored article collection in `validatePublicWikiArticles`, not here,
 * since that check needs the full collection.
 */
export const WikiLinkSegmentSchema = z
  .object({
    text: wikiText,
    articleSlug: wikiSlug,
  })
  .strict();

/**
 * Segment text is deliberately NOT trimmed: unlike a standalone paragraph,
 * a segment's leading/trailing spaces are load-bearing — they are what keep
 * "See " + link + " for how..." from concatenating into "SeeFor how...".
 */
const wikiSegmentText = z.string().min(1);

const WikiParagraphSegmentSchema = z.union([wikiSegmentText, WikiLinkSegmentSchema]);

/**
 * Ordinary prose, or — only when an author deliberately wants to link one
 * phrase within it — an ordered array of text and link segments that
 * concatenate into the same prose.
 */
const WikiParagraphSchema = z.union([wikiText, z.array(WikiParagraphSegmentSchema).min(1)]);

/** One structured content block within a Wiki article body. */
export const WikiArticleSectionSchema = z
  .object({
    heading: wikiText.optional(),
    paragraphs: z.array(WikiParagraphSchema).min(1).optional(),
    list: z.array(wikiText).min(1).optional(),
  })
  .strict()
  .refine((section) => Boolean(section.paragraphs?.length) || Boolean(section.list?.length), {
    message: "A Wiki section needs at least one paragraph or list item",
  });

/** The complete repository-authored Wiki article contract. */
export const WikiArticleSchema = z
  .object({
    slug: wikiSlug,
    title: wikiText,
    summary: wikiText,
    sections: z.array(WikiArticleSectionSchema).min(1),
  })
  .strict();

export type WikiLinkSegment = z.infer<typeof WikiLinkSegmentSchema>;
export type WikiParagraphSegment = z.infer<typeof WikiParagraphSegmentSchema>;
export type WikiParagraph = z.infer<typeof WikiParagraphSchema>;
export type WikiArticleSection = z.infer<typeof WikiArticleSectionSchema>;
export type WikiArticle = z.infer<typeof WikiArticleSchema>;
