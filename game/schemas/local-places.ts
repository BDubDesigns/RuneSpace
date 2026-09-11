import { z } from "zod";
import { LOCAL_PLACE_IDS, type LocalPlaceId } from "@/game/config/foundations";
import { ContentId } from "./ids";
import { LocationIdSchema } from "./locations";

/** A Local Place's stable identifier is a normal content ID (see game/schemas/ids). */
export const LocalPlaceIdSchema = ContentId;

/**
 * The authored access rule for one Local Place.
 *
 * Deliberately a closed two-kind union: a place is open, or it is visible but
 * locked with a player-facing in-world reason. There is no requirement
 * expression language, no condition vocabulary, and no world-state scripting
 * here. When a real Mission/world-state unlock is implemented it earns the
 * smallest additional explicit kind its unlock actually proves necessary.
 */
export const LocalPlaceAccessRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open") }).strict(),
  z.object({ kind: z.literal("locked"), reason: z.string().min(1) }).strict(),
]);

/**
 * The smallest typed, validated Local Place contract (#159).
 *
 * A Local Place belongs to exactly one parent World Location and deliberately
 * has NO axial coordinate, adjacency, or available action IDs: it is never a
 * Travel destination and never a second persisted character position. Nesting
 * is one level only — a Local Place cannot contain another.
 */
export const LocalPlaceDefinitionSchema = z
  .object({
    id: LocalPlaceIdSchema,
    parentLocationId: LocationIdSchema,
    displayName: z.string().min(1),
    description: z.string().min(1),
    access: LocalPlaceAccessRuleSchema,
    /** The merchant this place owns, when it hosts one. Server-validated. */
    merchantId: ContentId.optional(),
    presentation: z.object({
      scene: z
        .object({
          asset: z.string().regex(/^\/location-scenes\/.+\.(webp|png)$/),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          alt: z.string().min(1),
          focal: z
            .object({
              x: z.number().min(0).max(100),
              y: z.number().min(0).max(100),
            })
            .strict()
            .optional(),
        })
        .strict(),
    }),
  })
  .strict();

export type LocalPlaceAccessRule = z.infer<typeof LocalPlaceAccessRuleSchema>;
export type LocalPlaceDefinition = z.infer<typeof LocalPlaceDefinitionSchema>;

export const LOCAL_PLACE_ID_VALUES = Object.values(LOCAL_PLACE_IDS) as [
  LocalPlaceId,
  ...LocalPlaceId[],
];
