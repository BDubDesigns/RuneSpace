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
] as const satisfies readonly ConversationBackgroundDefinition[];

const backgroundById = new Map<string, ConversationBackgroundDefinition>(
  CONVERSATION_BACKGROUNDS.map((background) => [background.id, background]),
);

export function getConversationBackground(
  backgroundId: string,
): ConversationBackgroundDefinition | undefined {
  return backgroundById.get(backgroundId);
}
