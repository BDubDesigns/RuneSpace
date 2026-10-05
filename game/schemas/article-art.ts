import { z } from "zod";

/** Content identities only: an article never owns a copy of item/NPC art. */
export const ArticleArtSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("item"), itemId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("npc"),
      npcId: z.string().min(1),
      expressionId: z.string().min(1).optional(),
    })
    .strict(),
]);

export type ArticleArt = z.infer<typeof ArticleArtSchema>;
