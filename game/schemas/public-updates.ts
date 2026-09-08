import { z } from "zod";

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
        /^\/(?:landing|updates)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/,
        "Update images must be committed under public/landing or public/updates",
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

/** The complete repository-authored Update contract. */
export const PublicUpdateSchema = z
  .object({
    slug: updateSlug,
    title: updateText,
    publishedAt: z.string().datetime({ offset: true }),
    summary: updateText,
    body: z.array(updateText).min(1),
    patchNotes: z.array(PublicUpdatePatchSectionSchema).min(1),
    hero: PublicUpdateHeroSchema.optional(),
  })
  .strict();

export type PublicUpdate = z.infer<typeof PublicUpdateSchema>;
