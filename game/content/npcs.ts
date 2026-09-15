import {
  CONVERSATION_BACKGROUND_IDS,
  EXPRESSION_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  type ConversationBackgroundId,
  type ExpressionId,
  type LocalPlaceId,
  type LocationId,
  type MissionId,
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
  /**
   * Authored, Mission-derived placement (#190).
   *
   * Wade is at the Crash Site until Keep the Change completes and at his own
   * yard afterwards. That is one NPC in two places over time, derived from the
   * Mission record that already decides it — never a second "shop Wade", and
   * never a persisted relocation flag that could disagree with the Mission.
   *
   * Deliberately one authored move per NPC, in completion order. This is not an
   * NPC schedule or movement engine: a future story beat that moves somebody
   * again earns its own explicit entry.
   */
  relocation?: {
    afterCompletedMissionId: MissionId;
    homeLocationId: LocationId;
    localPlaceId?: LocalPlaceId;
  };
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
    // Wade has a business to run; he was only ever at the wreck because
    // somebody had to be. Once Keep the Change is done he is back at Rusk
    // Recovery and no longer at the Crash Site (#190).
    relocation: {
      afterCompletedMissionId: MISSION_IDS.keepTheChange,
      homeLocationId: LOCATION_IDS.ruskRecovery,
    },
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
    // Mara is met during Keep the Change's authored Bix scene (#170) and is
    // HH B&B's resident once that Mission opens the door. Her expression set is
    // shared vocabulary mapped to her own approved art: composed and
    // matter-of-fact reads as `firm` rather than wary or displeased.
    id: NPC_IDS.maraKells,
    displayName: "Mara Kells",
    role: "HH B&B owner",
    homeLocationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.hhBnb,
    conversationBackgroundId: CONVERSATION_BACKGROUND_IDS.hhBnbInterior,
    expressionAssets: {
      [EXPRESSION_IDS.neutral]: "/npc-art/mara-neutral-pragmatic.png",
      [EXPRESSION_IDS.amused]: "/npc-art/mara-warm-wry.png",
      [EXPRESSION_IDS.firm]: "/npc-art/mara-firm-no-nonsense.png",
    },
  },
] as const satisfies readonly NpcDefinition[];

const npcById = new Map<string, NpcDefinition>(NPCS.map((npc) => [npc.id, npc]));

export function getNpc(npcId: string): NpcDefinition | undefined {
  return npcById.get(npcId);
}

/** Where one NPC is right now, given the character's completed Missions (#190). */
export function resolveNpcPlacement(
  npc: NpcDefinition,
  completedMissionIds: ReadonlySet<string> = new Set(),
): { locationId: LocationId; localPlaceId?: LocalPlaceId } {
  const relocation = npc.relocation;
  if (relocation && completedMissionIds.has(relocation.afterCompletedMissionId)) {
    return {
      locationId: relocation.homeLocationId,
      ...(relocation.localPlaceId ? { localPlaceId: relocation.localPlaceId } : {}),
    };
  }
  return {
    locationId: npc.homeLocationId,
    ...(npc.localPlaceId ? { localPlaceId: npc.localPlaceId } : {}),
  };
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
 * Placement is resolved per NPC through `resolveNpcPlacement`, so an authored
 * Mission-derived move is simply where that person is now. The caller supplies
 * the character's completed Missions; omitting them resolves the pre-story
 * placement, which is the correct answer for a character who has completed
 * nothing.
 *
 * This is deliberately still a single-resident lookup: nothing here returns or
 * presents multiple simultaneously talkable NPCs.
 */
export function getResidentNpc(input: {
  locationId: string;
  localPlaceId?: string;
  completedMissionIds?: ReadonlySet<string>;
}): NpcDefinition | undefined {
  return NPCS.find((npc) => {
    const placement = resolveNpcPlacement(npc, input.completedMissionIds);
    return (
      placement.locationId === input.locationId && placement.localPlaceId === input.localPlaceId
    );
  });
}

export function resolveNpcExpression(npcId: string, expressionId: string): string | undefined {
  return getNpc(npcId)?.expressionAssets?.[expressionId as ExpressionId];
}
