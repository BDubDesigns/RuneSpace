import { z } from "zod";

const wikiSlug = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Wiki article slugs must be lowercase kebab-case for stable public routes",
  );

const wikiText = z.string().trim().min(1);

/** One structured content block within a Wiki article body. */
export const WikiArticleSectionSchema = z
  .object({
    heading: wikiText.optional(),
    paragraphs: z.array(wikiText).min(1).optional(),
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

export type WikiArticleSection = z.infer<typeof WikiArticleSectionSchema>;
export type WikiArticle = z.infer<typeof WikiArticleSchema>;
