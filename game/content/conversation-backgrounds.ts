import {
  CONVERSATION_BACKGROUND_IDS,
  LOCATION_IDS,
  type ConversationBackgroundId,
  type LocationId,
} from "@/game/config/foundations";

export type ConversationBackgroundDefinition = {
  id: ConversationBackgroundId;
  locationId: LocationId;
  asset: string;
  alt: string;
};

/**
 * People-free compositing surfaces. Both draft entries use the supplied
 * temporary background fixture; each has its own stable content identity so
 * final Crash Site and Jag artwork can be replaced independently.
 */
export const CONVERSATION_BACKGROUNDS = [
  {
    id: CONVERSATION_BACKGROUND_IDS.crashSiteExterior,
    locationId: LOCATION_IDS.crashSite,
    asset: "/npc-bg.png",
    alt: "Temporary people-free exterior background for a Crash Site conversation",
  },
  {
    id: CONVERSATION_BACKGROUND_IDS.theJagExterior,
    locationId: LOCATION_IDS.theJag,
    asset: "/npc-bg.png",
    alt: "Temporary people-free exterior background for a Jag conversation",
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
