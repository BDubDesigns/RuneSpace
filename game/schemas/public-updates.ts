import { z } from "zod";
import { WikiLinkSegmentSchema } from "@/game/schemas/public-wiki";
import { ArticleArtSchema } from "@/game/schemas/article-art";

const updateSlug = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Update slugs must be lowercase kebab-case for stable public routes",
  );

const updateText = z.string().trim().min(1);

/** A repository-owned image reference used by an Update's optional hero. */
export const PublicUpdateHeroSchema = z
  .object({
    src: z
      .string()
      .regex(
        /^\/(?:landing|updates|location-scenes)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/,
        "Update heroes must be committed under public/landing, public/updates or public/location-scenes",
      ),
    alt: updateText,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

/** One structured patch-note group belonging to the same canonical Update. */
export const PublicUpdatePatchSectionSchema = z
  .object({
    heading: updateText,
    items: z.array(updateText).min(1),
  })
  .strict();

/**
 * One body paragraph: plain prose, or — only where an author deliberately
 * links a phrase to a Wiki article (issue #248: the Community Rules and the
 * Safety & Privacy disclosure) — ordered text and Wiki link segments that
 * concatenate into the same prose. This is the Wiki's own link segment; its
 * `articleSlug` is checked against the authored Wiki in
 * `validatePublicUpdates`. Segment text keeps its load-bearing spaces.
 */
export const PublicUpdateParagraphSchema = z.union([
  updateText,
  z.array(z.union([z.string().min(1), WikiLinkSegmentSchema])).min(1),
]);

export const PublicUpdateFigureSchema = z
  .object({
    kind: z.literal("figure"),
    art: ArticleArtSchema,
    side: z.enum(["left", "right"]),
    caption: updateText.optional(),
  })
  .strict();

export const PublicUpdateBodyBlockSchema = z.union([
  PublicUpdateParagraphSchema,
  PublicUpdateFigureSchema,
]);

/** The complete repository-authored Update contract. */
export const PublicUpdateSchema = z
  .object({
    slug: updateSlug,
    title: updateText,
    publishedAt: z.string().datetime({ offset: true }),
    summary: updateText,
    body: z.array(PublicUpdateBodyBlockSchema).min(1),
    patchNotes: z.array(PublicUpdatePatchSectionSchema).min(1),
    hero: PublicUpdateHeroSchema.optional(),
  })
  .strict();

export type PublicUpdate = z.infer<typeof PublicUpdateSchema>;
export type PublicUpdateParagraph = z.infer<typeof PublicUpdateParagraphSchema>;
export type PublicUpdateFigure = z.infer<typeof PublicUpdateFigureSchema>;
