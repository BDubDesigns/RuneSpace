import { z } from "zod";

/**
 * Branded stable-ID primitives for typed game content.
 *
 * Every future content definition (locations, items, quests, actions, etc.)
 * will reference stable string IDs. Centralizing the ID shape here is the
 * single source of truth for "what is a valid content identifier" and prevents
 * ad-hoc stringly-typed IDs from leaking across the codebase.
 *
 * This defines NO game content — only the identifier contract that future
 * content modules will reuse. No balance values, names, or lore are present.
 */

export const ContentId = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_]*$/, "Content IDs must be lowercase snake_case starting with a letter");

export type ContentId = z.infer<typeof ContentId>;

/** Parse a raw string into a validated content ID, or throw. */
export function asContentId(raw: string): ContentId {
  return ContentId.parse(raw);
}
