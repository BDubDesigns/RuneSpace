import {
  CONVERSATION_BACKGROUND_IDS,
  LOCATION_IDS,
  type ConversationBackgroundId,
  type LocationId,
} from "@/game/config/foundations";
import { getLocation } from "./locations";

export type ConversationBackgroundDefinition = {
  id: ConversationBackgroundId;
  locationId: LocationId;
  asset: string;
  alt: string;
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
] as const satisfies readonly ConversationBackgroundDefinition[];

const backgroundById = new Map<string, ConversationBackgroundDefinition>(
  CONVERSATION_BACKGROUNDS.map((background) => [background.id, background]),
);

export function getConversationBackground(
  backgroundId: string,
): ConversationBackgroundDefinition | undefined {
  return backgroundById.get(backgroundId);
}
