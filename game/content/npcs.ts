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

/**
 * The first two static NPCs. The art paths are deliberately temporary draft
 * fixtures and are isolated to this content boundary so production art can be
 * swapped without changing dialogue or presentation architecture.
 */
export const NPCS = [
  {
    id: NPC_IDS.wadeRusk,
    displayName: "Wade Rusk",
    role: "Temporary NPC content pending approval",
    homeLocationId: LOCATION_IDS.crashSite,
    conversationBackgroundId: CONVERSATION_BACKGROUND_IDS.crashSiteExterior,
    expressionAssets: { [EXPRESSION_IDS.neutral]: "/npc.png" },
  },
  {
    id: NPC_IDS.tansyRusk,
    displayName: "Tansy Rusk",
    role: "Temporary NPC content pending approval",
    homeLocationId: LOCATION_IDS.theJag,
    conversationBackgroundId: CONVERSATION_BACKGROUND_IDS.theJagExterior,
    expressionAssets: { [EXPRESSION_IDS.neutral]: "/npc.png" },
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
