import { z } from "zod";
import { LOCATION_IDS, PLANET_IDS, type LocationId } from "@/game/config/foundations";
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

const ScenePercent = z.number().min(0).max(100);

/**
 * A transparent layer composed over a scene's opaque background (#351).
 *
 * Placement is authored in the **background's own source space** — percent of its
 * canvas — never in pixels or per breakpoint. The renderer lays the background and
 * every overlay out on one shared stage that takes a single cover/crop transform, so
 * an overlay cannot drift from the spot it was placed on at any viewport. Only
 * `width` is authored: the overlay's height follows its own intrinsic aspect ratio,
 * so a ship is never stretched.
 *
 * The overlay is decorative. The scene's own `alt` describes the whole composition,
 * so a screen reader hears one description of the place, not the background and then
 * a second image.
 */
export const SceneOverlaySchema = z
  .object({
    asset: z.string().regex(/^\/location-scenes\/.+\.(webp|png)$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    placement: z
      .object({
        left: ScenePercent,
        top: ScenePercent,
        width: z.number().positive().max(100),
      })
      .strict(),
  })
  .strict();

/**
 * The committed 4:1 artwork one presentation shows.
 *
 * `overlay`, when authored, is one transparent layer composed over `asset` (#351).
 * Omitting it is a first-class state — the bare background — not a missing asset.
 */
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
    overlay: SceneOverlaySchema.optional(),
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
 * `requires` deliberately references only three kinds of authoritative fact:
 * a Mission the character has accepted, a repair target they have completed,
 * and whether their ship is actually berthed at this very location (#358). The
 * third earned its place with two real consumers — the Crash Site shows no ship
 * once it has left, and Holo Hollow Landing shows it once it has arrived. It is
 * NOT a condition scripting language, and it is not a place to grow one.
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
        /**
         * `here`: the character's ship is berthed at this location. `elsewhere`:
         * it is berthed somewhere else. Read from the ship's own authoritative
         * berth, never from where the character happens to be standing.
         */
        shipBerth: z.enum(["here", "elsewhere"]).optional(),
      })
      .strict()
      .refine(
        (requires) =>
          requires.acceptedMissionId != null ||
          requires.completedRepairTargetId != null ||
          requires.shipBerth != null,
        { message: "A location state variant must require at least one authoritative fact" },
      ),
    /**
     * The name this state is known by (#441): the Crash Site is the character's
     * own "Resonance Site" once their Rig stands there. Presentation only: the
     * stable location ID, hex, adjacency and teleport destination are unchanged,
     * and another character's location is unaffected.
     */
    displayName: z.string().min(1).optional(),
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
    /**
     * The planet this World Location belongs to (#373): the scope of its local map.
     * Walking adjacency and axial coordinates are planet-local, so two planets may
     * both author (0,0), and an edge can never join two worlds.
     */
    planetId: z.enum([PLANET_IDS.skatboll, PLANET_IDS.stillreach]),
    /**
     * The starter region, when the planet's region has an approved name. Skatboll's
     * is `holo_hollow`; Stillreach's has not been approved, so its locations author
     * none rather than an invented one.
     */
    region: z.enum(["holo_hollow"]).optional(),
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
        "south_access_track",
        "the_south_cut",
        "holo_hollow_landing",
        "stillreach_landing_station",
        "windward_track",
        "hilltop_workshop",
        "prospecting_quarry",
        "the_low_hum",
        "the_survey_line",
        "the_dry_seam",
        "harmonic_workings",
        "werner_lab",
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
        "south_access_track",
        "the_south_cut",
        "holo_hollow_landing",
        "stillreach_landing_station",
        "windward_track",
        "hilltop_workshop",
        "prospecting_quarry",
        "the_low_hum",
        "the_survey_line",
        "the_dry_seam",
        "harmonic_workings",
        "werner_lab",
      ]),
      /** Local Place directory heading for this World Location, when it has venues. */
      localPlacesEyebrow: z.string().trim().min(1).optional(),
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

/**
 * Validate that every adjacency relation is reciprocal (no silent one-way edges)
 * and stays on one planet (#373): a walking edge never joins two worlds.
 */
export function assertBidirectionalAdjacency(locations: readonly LocationDefinition[]): void {
  const byId = new Map(locations.map((location) => [location.id, location]));
  for (const location of locations) {
    for (const neighbor of location.adjacentLocationIds) {
      const reciprocal = byId.get(neighbor);
      if (!reciprocal) {
        throw new Error(`Location ${location.id} references unknown neighbor ${neighbor}`);
      }
      if (!reciprocal.adjacentLocationIds.includes(location.id)) {
        throw new Error(`Location adjacency is not bidirectional: ${location.id} -> ${neighbor}`);
      }
      if (reciprocal.planetId !== location.planetId) {
        throw new Error(
          `Location adjacency crosses planets: ${location.id} (${location.planetId}) -> ${neighbor} (${reciprocal.planetId})`,
        );
      }
    }
  }
}

/**
 * Validate planet-scoped local maps (#373): within one planet every axial
 * coordinate is unique (two planets may both use the same one), and a region
 * may only belong to the planet it names.
 */
export function assertPlanetMembership(locations: readonly LocationDefinition[]): void {
  const coordinates = new Set<string>();
  for (const location of locations) {
    const { q, r } = location.presentation.localMap.axial;
    const key = `${location.planetId}:${q},${r}`;
    if (coordinates.has(key)) {
      throw new Error(`Duplicate local map coordinate on ${location.planetId}: ${q},${r}`);
    }
    coordinates.add(key);
    if (location.region === "holo_hollow" && location.planetId !== PLANET_IDS.skatboll) {
      throw new Error(`Region holo_hollow belongs to Skatboll, not ${location.planetId}`);
    }
  }
}

export const LOCATION_ID_VALUES = Object.values(LOCATION_IDS) as [LocationId, ...LocationId[]];
