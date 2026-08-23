import {
  CONVERSATION_BACKGROUND_IDS,
  EXPRESSION_IDS,
  LOCATION_IDS,
  NPC_IDS,
  type ConversationBackgroundId,
  type ExpressionId,
  type LocationId,
  type NpcId,
} from "@/game/config/foundations";

export type NpcDefinition = {
  id: NpcId;
  displayName: string;
  role: string;
  homeLocationId: LocationId;
  conversationBackgroundId: ConversationBackgroundId;
  /** Expression art is content-selected per authored beat, never inferred from text. */
  expressionAssets: Readonly<Partial<Record<ExpressionId, string>>>;
};

/** The first two static NPCs for the Walk It Off story slice. */
export const NPCS = [
  {
    id: NPC_IDS.wadeRusk,
    displayName: "Wade Rusk",
    role: "Local recovery & salvage operator",
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
] as const satisfies readonly NpcDefinition[];

const npcById = new Map<string, NpcDefinition>(NPCS.map((npc) => [npc.id, npc]));

export function getNpc(npcId: string): NpcDefinition | undefined {
  return npcById.get(npcId);
}

export function getNpcAtLocation(locationId: string): NpcDefinition | undefined {
  return NPCS.find((npc) => npc.homeLocationId === locationId);
}

export function resolveNpcExpression(npcId: string, expressionId: string): string | undefined {
  return getNpc(npcId)?.expressionAssets[expressionId as ExpressionId];
}
