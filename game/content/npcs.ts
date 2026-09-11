import {
  CONVERSATION_BACKGROUND_IDS,
  EXPRESSION_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  NPC_IDS,
  type ConversationBackgroundId,
  type ExpressionId,
  type LocalPlaceId,
  type LocationId,
  type NpcId,
} from "@/game/config/foundations";

export type NpcDefinition = {
  id: NpcId;
  displayName: string;
  role: string;
  homeLocationId: LocationId;
  /**
   * The Local Place inside `homeLocationId` this resident occupies (#159).
   *
   * Absent for an NPC who is simply present at their World Location, which is
   * how every pre-Holo-Hollow NPC works. Present for a town resident who is
   * only found inside one specific place, which is what lets two residents
   * share one World Location without a multi-NPC interaction system.
   */
  localPlaceId?: LocalPlaceId;
  /** Present once the NPC has authored conversation content. */
  conversationBackgroundId?: ConversationBackgroundId;
  /** Expression art is content-selected per authored beat, never inferred from text. */
  expressionAssets?: Readonly<Partial<Record<ExpressionId, string>>>;
};

/** The static NPC roster. */
export const NPCS: readonly NpcDefinition[] = [
  {
    id: NPC_IDS.wadeRusk,
    displayName: "Wade Rusk",
    role: "Holo Hollow recovery & salvage operator",
    homeLocationId: LOCATION_IDS.crashSite,
    conversationBackgroundId: CONVERSATION_BACKGROUND_IDS.crashSiteExterior,
    expressionAssets: {
      [EXPRESSION_IDS.neutral]: "/npc-art/wade-neutral.png",
      [EXPRESSION_IDS.concerned]: "/npc-art/wade-concerned.png",
      [EXPRESSION_IDS.scowl]: "/npc-art/wade-scowl.png",
    },
  },
  {
    id: NPC_IDS.tansyRusk,
    displayName: "Tansy Rusk",
    role: "Field mechanic & miner",
    homeLocationId: LOCATION_IDS.theJag,
    conversationBackgroundId: CONVERSATION_BACKGROUND_IDS.theJagExterior,
    expressionAssets: {
      [EXPRESSION_IDS.neutral]: "/npc-art/tansy-neutral.png",
      [EXPRESSION_IDS.concerned]: "/npc-art/tansy-concerned.png",
      [EXPRESSION_IDS.smile]: "/npc-art/tansy-smile.png",
    },
  },
  {
    id: NPC_IDS.bixWeller,
    displayName: "Bix Weller",
    role: "Souvenir & mining-supply shopkeeper",
    homeLocationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
    conversationBackgroundId: CONVERSATION_BACKGROUND_IDS.holoHollowSouvenirsInterior,
    expressionAssets: {
      [EXPRESSION_IDS.neutral]: "/npc-art/bix-neutral-dry.png",
      [EXPRESSION_IDS.amused]: "/npc-art/bix-amused-knowing.png",
      [EXPRESSION_IDS.concerned]: "/npc-art/bix-skeptical-concerned.png",
    },
  },
  {
    id: NPC_IDS.rennCalder,
    displayName: "Renn Calder",
    role: "Ferrite miner",
    homeLocationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.holoHollowAssistanceCenter,
    conversationBackgroundId: CONVERSATION_BACKGROUND_IDS.holoHollowAssistanceCenterInterior,
    expressionAssets: {
      [EXPRESSION_IDS.neutral]: "/npc-art/renn-neutral-tired.png",
      [EXPRESSION_IDS.sardonic]: "/npc-art/renn-dry-sardonic.png",
      [EXPRESSION_IDS.guarded]: "/npc-art/renn-serious-guarded.png",
    },
  },
  {
    // Mara owns HH B&B, which is visible but locked in this slice, so she has
    // no authored conversation yet. The follow-up Wade apprentice Mission owns
    // her introduction, her portrait set, and the B&B interior; her identity is
    // registered here so the locked place already has its resident.
    id: NPC_IDS.maraKells,
    displayName: "Mara Kells",
    role: "HH B&B owner",
    homeLocationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.hhBnb,
  },
] as const satisfies readonly NpcDefinition[];

const npcById = new Map<string, NpcDefinition>(NPCS.map((npc) => [npc.id, npc]));

export function getNpc(npcId: string): NpcDefinition | undefined {
  return npcById.get(npcId);
}

/**
 * Resolve the persistent resident for a spatial context.
 *
 * A World Location without an active Local Place resolves the NPC who has no
 * Local Place of their own — the long-standing behavior for Wade, Tansy, and
 * every ordinary location. Supplying a Local Place resolves that place's own
 * resident instead, which is how Bix and Renn occupy one shared World Location
 * without either being exposed merely for standing in town.
 *
 * This is deliberately still a single-resident lookup: nothing here returns or
 * presents multiple simultaneously talkable NPCs.
 */
export function getResidentNpc(input: {
  locationId: string;
  localPlaceId?: string;
}): NpcDefinition | undefined {
  return NPCS.find(
    (npc) => npc.homeLocationId === input.locationId && npc.localPlaceId === input.localPlaceId,
  );
}

export function resolveNpcExpression(npcId: string, expressionId: string): string | undefined {
  return getNpc(npcId)?.expressionAssets?.[expressionId as ExpressionId];
}
