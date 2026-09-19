import { z } from "zod";
import { LOCATION_IDS, type LocationId } from "@/game/config/foundations";
import { ContentId } from "./ids";

/** A location's stable identifier is a normal content ID (see game/schemas/ids). */
export const LocationIdSchema = ContentId;
export type LocationIdValue = LocationId;

/** Future-dormant activities communicate intent without an enabled control. */
export const LocationDormantActivitySchema = z.object({
  skillId: z.string(),
  label: z.string(),
  status: z.string(),
});

/** The committed 4:1 artwork one presentation shows. */
export const LocationSceneSchema = z
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
 * One authored conditional presentation of a World Location (#209).
 *
 * Deep Jag is the first location whose player-facing state changes durably, so
 * this is the narrow reusable boundary that resolves scene, map status,
 * available actions, and whether an authored walking edge is currently usable
 * — from facts the game already owns.
 *
 * `requires` deliberately references only two kinds of authoritative fact:
 * a Mission the character has accepted, and a repair target they have
 * completed. It is NOT a condition scripting language, and it is not a place to
 * grow one: a third kind of fact should be justified by a second real consumer,
 * the same rule the rest of this codebase follows.
 *
 * Every field is optional and overrides the location's own unconditional value,
 * so an existing location with no variants behaves exactly as before.
 */
export const LocationStateVariantSchema = z
  .object({
    id: ContentId,
    requires: z
      .object({
        acceptedMissionId: ContentId.optional(),
        completedRepairTargetId: ContentId.optional(),
      })
      .strict()
      .refine(
        (requires) => requires.acceptedMissionId != null || requires.completedRepairTargetId != null,
        { message: "A location state variant must require at least one authoritative fact" },
      ),
    description: z.string().optional(),
    travelable: z.boolean().optional(),
    mapStatus: z.string().min(1).optional(),
    availableActionIds: z.array(z.string()).optional(),
    scene: LocationSceneSchema.optional(),
  })
  .strict();

export type LocationStateVariant = z.infer<typeof LocationStateVariantSchema>;

/**
 * The smallest typed, validated location contract for the local world. Locations
 * are referenced by stable ID; adjacency, available activities, and presentation
 * metadata belong here, never in UI literals.
 */
export const LocationDefinitionSchema = z
  .object({
    id: LocationIdSchema,
    displayName: z.string(),
    description: z.string(),
    region: z.enum(["holo_hollow"]),
    adjacentLocationIds: z.array(LocationIdSchema),
    availableActionIds: z.array(z.string()),
    /**
     * The merchant this World Location hosts, when it hosts one (#190). The
     * same relationship a Local Place already authors: the venue names the
     * merchant, and the merchant owns its own prices and its own unlock.
     */
    merchantId: ContentId.optional(),
    /**
     * Whether an authored walking edge into this location is usable by default
     * (#209). Everything shipped before Deep Jag is unconditionally travelable,
     * so this defaults to true and no existing entry changes.
     */
    travelable: z.boolean().default(true),
    /**
     * The short status the Map shows for this location, when it shows one
     * (#209) — `CAVE-IN`, `MINING`. It is gameplay status presentation, not a
     * second map identifier.
     */
    mapStatus: z.string().min(1).optional(),
    /**
     * Ordered conditional presentations, most specific first. The first variant
     * whose `requires` is satisfied wins; when none is, the location's own
     * unconditional fields apply.
     */
    stateVariants: z.array(LocationStateVariantSchema).default([]),
    dormantActivities: z.array(LocationDormantActivitySchema),
    presentation: z.object({
      mapIconKey: z.enum([
        "crash_site_deposit",
        "processing_yard",
        "power_annex",
        "the_long_scramble",
        "the_jag",
        "holo_hollow",
        "rusk_recovery",
        "deep_jag",
      ]),
      layout: z.enum([
        "crash_site",
        "processing_yard",
        "power_annex",
        "the_long_scramble",
        "the_jag",
        "holo_hollow",
        "rusk_recovery",
        "deep_jag",
      ]),
      localMap: z
        .object({
          axial: z.object({ q: z.number().int(), r: z.number().int() }).strict(),
          label: z.string().min(1),
        })
        .strict(),
      scene: LocationSceneSchema,
    }),
  })
  .strict();

export type LocationDefinition = z.infer<typeof LocationDefinitionSchema>;

/**
 * The authoring shape, before Zod applies defaults (#209). Content literals
 * satisfy this so an existing entry never has to restate `travelable: true`
 * and an empty `stateVariants` just to keep compiling.
 */
export type LocationDefinitionInput = z.input<typeof LocationDefinitionSchema>;

/** Validate that every adjacency relation is reciprocal (no silent one-way edges). */
export function assertBidirectionalAdjacency(locations: readonly LocationDefinition[]): void {
  const ids = new Set(locations.map((location) => location.id));
  for (const location of locations) {
    for (const neighbor of location.adjacentLocationIds) {
      if (!ids.has(neighbor)) {
        throw new Error(`Location ${location.id} references unknown neighbor ${neighbor}`);
      }
      const reciprocal = locations.find((candidate) => candidate.id === neighbor);
      if (!reciprocal?.adjacentLocationIds.includes(location.id)) {
        throw new Error(`Location adjacency is not bidirectional: ${location.id} -> ${neighbor}`);
      }
    }
  }
}

export const LOCATION_ID_VALUES = Object.values(LOCATION_IDS) as [LocationId, ...LocationId[]];
