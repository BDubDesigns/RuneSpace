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
    adjacentLocationIds: z.array(LocationIdSchema),
    availableActionIds: z.array(z.string()),
    dormantActivities: z.array(LocationDormantActivitySchema),
    presentation: z.object({
      mapIconKey: z.enum([
        "crash_site_deposit",
        "processing_yard",
        "power_annex",
        "the_long_scramble",
        "the_jag",
      ]),
      layout: z.enum([
        "crash_site",
        "processing_yard",
        "power_annex",
        "the_long_scramble",
        "the_jag",
      ]),
      localMap: z
        .object({
          axial: z.object({ q: z.number().int(), r: z.number().int() }).strict(),
          label: z.string().min(1),
        })
        .strict(),
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

export type LocationDefinition = z.infer<typeof LocationDefinitionSchema>;

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
