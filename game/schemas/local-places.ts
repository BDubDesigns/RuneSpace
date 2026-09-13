import { z } from "zod";
import { LOCAL_PLACE_IDS, type LocalPlaceId } from "@/game/config/foundations";
import { ContentId } from "./ids";
import { LocationIdSchema } from "./locations";

/** A Local Place's stable identifier is a normal content ID (see game/schemas/ids). */
export const LocalPlaceIdSchema = ContentId;

/**
 * The authored access rule for one Local Place.
 *
 * Deliberately a closed union of the three rules real content has proven: a
 * place is open, permanently locked with a player-facing in-world reason, or
 * locked until one authored Mission is completed (#170 unlocks HH B&B when
 * Keep the Change completes). There is still no requirement expression
 * language, no condition vocabulary, and no world-state scripting here.
 *
 * The mission-gated kind stores no unlock flag of its own: completion of the
 * named Mission is already authoritative character state, so access is derived
 * from it rather than persisted a second time.
 */
export const LocalPlaceAccessRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open") }).strict(),
  z.object({ kind: z.literal("locked"), reason: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("locked_until_mission_completed"),
      missionId: ContentId,
      reason: z.string().min(1),
    })
    .strict(),
]);

/**
 * The smallest typed, validated Local Place contract (#159).
 *
 * A Local Place belongs to exactly one parent World Location and deliberately
 * has NO axial coordinate, adjacency, or available action IDs: it is never a
 * Travel destination and never a second persisted character position. Nesting
 * is one level only — a Local Place cannot contain another.
 */
const LocalPlaceSceneSchema = z
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
  .strict();

/**
 * How one Local Place looks and reads once a repair target inside it is
 * finished (#172).
 *
 * This is the whole contract for a persistent visible world change: the place
 * authors both states, and presentation picks between them from authoritative
 * repair completion. There is no world-state scripting here and no second
 * persisted flag — and deliberately no generic "variant" system, because the
 * only thing that changes a place today is a repair the player performed.
 */
const LocalPlaceRepairedPresentationSchema = z
  .object({
    /** The repair target whose completion switches this place over. */
    repairTargetId: ContentId,
    description: z.string().min(1),
    scene: LocalPlaceSceneSchema,
  })
  .strict();

export const LocalPlaceDefinitionSchema = z
  .object({
    id: LocalPlaceIdSchema,
    parentLocationId: LocationIdSchema,
    displayName: z.string().min(1),
    description: z.string().min(1),
    access: LocalPlaceAccessRuleSchema,
    /** The merchant this place owns, when it hosts one. Server-validated. */
    merchantId: ContentId.optional(),
    presentation: z
      .object({
        scene: LocalPlaceSceneSchema,
        /** Authored only by a place something inside it can permanently change. */
        repaired: LocalPlaceRepairedPresentationSchema.optional(),
      })
      .strict(),
  })
  .strict();

export type LocalPlaceAccessRule = z.infer<typeof LocalPlaceAccessRuleSchema>;
export type LocalPlaceScene = z.infer<typeof LocalPlaceSceneSchema>;
export type LocalPlaceDefinition = z.infer<typeof LocalPlaceDefinitionSchema>;

export const LOCAL_PLACE_ID_VALUES = Object.values(LOCAL_PLACE_IDS) as [
  LocalPlaceId,
  ...LocalPlaceId[],
];
