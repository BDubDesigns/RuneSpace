import {
  CONVERSATION_BACKGROUND_IDS,
  LOCATION_IDS,
  LOCAL_PLACE_IDS,
  REPAIR_TARGET_IDS,
  type ConversationBackgroundId,
  type LocationId,
  type LocalPlaceId,
  type RepairTargetId,
} from "@/game/config/foundations";
import type { LocationDefinition } from "@/game/schemas/locations";
import { CRASH_SITE_SHIP_RESTORED_VARIANT_ID, getLocation } from "./locations";
import { getLocalPlaceInLocation } from "./local-places";

export type ConversationBackgroundDefinition = {
  id: ConversationBackgroundId;
  locationId: LocationId;
  /** The specific Local Place depicted, if this backdrop is inside one. */
  localPlaceId?: LocalPlaceId;
  asset: string;
  alt: string;
  /**
   * A layered scene this background is composed from (#351). When present the
   * conversation renders the same stage the Location header does, so a ship stays
   * on its landing mark; `asset` and `alt` remain the base layer and the
   * composition's description.
   */
  composition?: LocationDefinition["presentation"]["scene"];
  /**
   * The matching background this one becomes once a repair is finished (#292).
   *
   * The same before/after rule a Local Place's `repaired` scene already
   * follows, applied to a conversation backdrop: a room whose state the player
   * changed is shown in that state from the repair's own completion, with no
   * cosmetic flag of its own. It is resolved when beats are presented
   * (`resolveConversationBackgroundId`), so a replayable topic authored against
   * the unfinished room shows the finished one once the work is done, while a
   * beat authored against the finished room is simply that room.
   */
  repaired?: { repairTargetId: RepairTargetId; backgroundId: ConversationBackgroundId };
};

const crashSiteLocation = getLocation(LOCATION_IDS.crashSite);
const crashSiteScene = crashSiteLocation?.presentation.scene;
// The repaired ship (#330) is the Crash Site's own state variant, so the location
// registry stays the one place the scene is authored.
const crashSiteRestored = crashSiteLocation?.stateVariants.find(
  (variant) => variant.id === CRASH_SITE_SHIP_RESTORED_VARIANT_ID,
);
const crashSiteRepairedScene = crashSiteRestored?.scene;
// The background follows exactly the repair the variant requires, and nothing
// else: a variant that also needed, say, an accepted Mission could not be
// expressed by a background's `repaired` rule, so that must fail here rather than
// let the scene and the conversation backdrop silently disagree.
const crashSiteRestoredRepairId = crashSiteRestored?.requires.completedRepairTargetId;
if (
  crashSiteRestored &&
  (crashSiteRestoredRepairId === undefined || crashSiteRestored.requires.acceptedMissionId)
) {
  throw new Error(
    "The Crash Site restored-ship variant must require exactly one completed repair target.",
  );
}
const theJagScene = getLocation(LOCATION_IDS.theJag)?.presentation.scene;

if (!crashSiteScene || !crashSiteRepairedScene || !theJagScene) {
  throw new Error(
    "Conversation backgrounds require the Crash Site (crashed and repaired) and The Jag scenes",
  );
}

/** People-free conversation surfaces reuse the authoritative location scenes. */
export const CONVERSATION_BACKGROUNDS = [
  {
    id: CONVERSATION_BACKGROUND_IDS.crashSiteExterior,
    locationId: LOCATION_IDS.crashSite,
    asset: crashSiteScene.asset,
    alt: crashSiteScene.alt,
    composition: crashSiteScene,
    // The same before/after rule as Curly's room: the ship in a conversation is
    // the ship as this character has left it (#330).
    repaired: {
      repairTargetId: crashSiteRestoredRepairId as RepairTargetId,
      backgroundId: CONVERSATION_BACKGROUND_IDS.crashSiteExteriorRepaired,
    },
  },
  {
    id: CONVERSATION_BACKGROUND_IDS.crashSiteExteriorRepaired,
    locationId: LOCATION_IDS.crashSite,
    asset: crashSiteRepairedScene.asset,
    alt: crashSiteRepairedScene.alt,
    composition: crashSiteRepairedScene,
  },
  {
    id: CONVERSATION_BACKGROUND_IDS.theJagExterior,
    locationId: LOCATION_IDS.theJag,
    asset: theJagScene.asset,
    alt: theJagScene.alt,
  },
  // Holo Hollow's residents are met inside their Local Places, so these are
  // dedicated approved interior art rather than a reused exterior scene. The
  // location is still the parent World Location: a Local Place never owns a
  // world position of its own.
  {
    id: CONVERSATION_BACKGROUND_IDS.holoHollowSouvenirsInterior,
    locationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
    asset: "/location-scenes/holo-hollow-souvenirs-interior.webp",
    alt: "Cluttered shop interior with souvenir shelves beside racked mining supplies",
  },
  {
    id: CONVERSATION_BACKGROUND_IDS.holoHollowAssistanceCenterInterior,
    locationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.holoHollowAssistanceCenter,
    asset: "/location-scenes/holo-hollow-assistance-center-interior.webp",
    alt: "Assistance center interior with a service counter, posted notices, and stacked ration crates",
  },
  {
    id: CONVERSATION_BACKGROUND_IDS.hhBnbInterior,
    locationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.hhBnb,
    asset: "/location-scenes/hh-bnb-interior.webp",
    alt: "Working inn interior with a worn bar, mismatched seating, and tourism-era fittings kept in service",
  },
  {
    // Wade's yard has its own approved dialogue art (#190): the 4:1 location
    // scene is the place, this is the surface a conversation happens against.
    id: CONVERSATION_BACKGROUND_IDS.ruskRecoveryYard,
    locationId: LOCATION_IDS.ruskRecovery,
    asset: "/location-scenes/rusk-recovery-dialogue.webp",
    alt: "Recovery yard working area with racked salvage, stripped components, and a welding bench",
  },
  // Curly's guest room at HH B&B (#292): one approved matched pair sharing a
  // camera, so the only thing that changes is the thing the player built. The
  // unfinished room resolves to the finished one from the mount's completion.
  {
    id: CONVERSATION_BACKGROUND_IDS.curlyRoomBefore,
    locationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.hhBnb,
    asset: "/location-scenes/curly-room-before.webp",
    alt: "Lamplit inn guest room crowded with trunks, suitcases, and duffels piled around the bed, a window looking out on distant spires",
    repaired: {
      repairTargetId: REPAIR_TARGET_IDS.curlyStashMount,
      backgroundId: CONVERSATION_BACKGROUND_IDS.curlyRoomAfter,
    },
  },
  {
    id: CONVERSATION_BACKGROUND_IDS.curlyRoomAfter,
    locationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.hhBnb,
    asset: "/location-scenes/curly-room-after.webp",
    alt: "The same lamplit guest room with a MYKEA storage container mounted on a welded frame above the bed, the luggage around it a little tidier",
  },
  {
    // Last Leg Trading's counter (#357): approved interior art with no person
    // baked in, so Toll is always the separate portrait over it. The 4:1
    // exterior is the Local Place's own scene and is not reused here.
    id: CONVERSATION_BACKGROUND_IDS.lastLegTradingInterior,
    locationId: LOCATION_IDS.holoHollowLanding,
    localPlaceId: LOCAL_PLACE_IDS.lastLegTrading,
    asset: "/location-scenes/last-leg-trading-interior.webp",
    alt: "A fuel, freight and salvage trading counter under a lit Last Leg Trading sign, shelves and crates to the left, red and white fuel canisters to the right, wet floor reflecting warm overhead lights",
  },
  {
    // The Wise Old Enby's workshop (#389): approved empty 15:8 interior, the Enby
    // always the separate portrait over it. Hilltop Workshop has no Local Place,
    // so it is labelled by its World Location; the 4:1 panorama is not reused.
    id: CONVERSATION_BACKGROUND_IDS.hilltopWorkshopInterior,
    locationId: LOCATION_IDS.hilltopWorkshop,
    asset: "/location-scenes/hilltop-workshop-interior.webp",
    alt: "A cluttered, lamplit workshop interior: map-covered walls, shelves of glowing crystals and books, workbenches and crates, a caged machine humming with blue light at the back, and a wide window onto aurora-lit hills",
  },
] as const satisfies readonly ConversationBackgroundDefinition[];

const backgroundById = new Map<string, ConversationBackgroundDefinition>(
  CONVERSATION_BACKGROUNDS.map((background) => [background.id, background]),
);

export function getConversationBackground(
  backgroundId: string,
): ConversationBackgroundDefinition | undefined {
  return backgroundById.get(backgroundId);
}

/**
 * The background a beat is actually presented against, given which repairs the
 * character has finished (#292). A background with no `repaired` variant, or
 * whose repair is unfinished, is itself.
 */
export function resolveConversationBackgroundId(
  backgroundId: ConversationBackgroundId,
  completedRepairTargetIds: ReadonlySet<string>,
): ConversationBackgroundId {
  const repaired = backgroundById.get(backgroundId)?.repaired;
  return repaired && completedRepairTargetIds.has(repaired.repairTargetId)
    ? repaired.backgroundId
    : backgroundId;
}

/** The actual venue pictured on a dialogue background, not merely its map hex. */
export function getConversationBackgroundPlaceName(backgroundId: string): string | undefined {
  const background = getConversationBackground(backgroundId);
  if (!background) return undefined;
  if (background.localPlaceId) {
    const place = getLocalPlaceInLocation(background.locationId, background.localPlaceId);
    if (!place) {
      throw new Error(
        `Dialogue background "${background.id}" references a Local Place outside its World Location.`,
      );
    }
    return place.displayName;
  }
  return getLocation(background.locationId)?.displayName;
}
