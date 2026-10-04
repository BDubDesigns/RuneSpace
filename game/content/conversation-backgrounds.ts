import {
  CONVERSATION_BACKGROUND_IDS,
  LOCATION_IDS,
  REPAIR_TARGET_IDS,
  type ConversationBackgroundId,
  type LocationId,
  type RepairTargetId,
} from "@/game/config/foundations";
import { getLocation } from "./locations";

export type ConversationBackgroundDefinition = {
  id: ConversationBackgroundId;
  locationId: LocationId;
  asset: string;
  alt: string;
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

const crashSiteScene = getLocation(LOCATION_IDS.crashSite)?.presentation.scene;
const theJagScene = getLocation(LOCATION_IDS.theJag)?.presentation.scene;

if (!crashSiteScene || !theJagScene) {
  throw new Error("Walk It Off conversation backgrounds require Crash Site and The Jag scenes");
}

/** People-free conversation surfaces reuse the authoritative location scenes. */
export const CONVERSATION_BACKGROUNDS = [
  {
    id: CONVERSATION_BACKGROUND_IDS.crashSiteExterior,
    locationId: LOCATION_IDS.crashSite,
    asset: crashSiteScene.asset,
    alt: crashSiteScene.alt,
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
    asset: "/location-scenes/holo-hollow-souvenirs-interior.webp",
    alt: "Cluttered shop interior with souvenir shelves beside racked mining supplies",
  },
  {
    id: CONVERSATION_BACKGROUND_IDS.holoHollowAssistanceCenterInterior,
    locationId: LOCATION_IDS.holoHollow,
    asset: "/location-scenes/holo-hollow-assistance-center-interior.webp",
    alt: "Assistance center interior with a service counter, posted notices, and stacked ration crates",
  },
  {
    id: CONVERSATION_BACKGROUND_IDS.hhBnbInterior,
    locationId: LOCATION_IDS.holoHollow,
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
    asset: "/location-scenes/curly-room-after.webp",
    alt: "The same lamplit guest room with a MYKEA storage container mounted on a welded frame above the bed, the luggage around it a little tidier",
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
