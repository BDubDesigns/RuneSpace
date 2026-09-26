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

/** One authored, Mission-derived move (#190, #231). */
export type NpcRelocation = {
  afterCompletedMissionId: MissionId;
  locationId: LocationId;
  /** Present only when the NPC moves into a Local Place of `locationId`. */
  localPlaceId?: LocalPlaceId;
  /**
   * The venue a present-tense local conversation with this person plays
   * against once they have moved. Authored scenes keep their own authored
   * backgrounds; only a sequence marked `presentsAtCurrentVenue` reads this.
   */
  conversationBackgroundId?: ConversationBackgroundId;
};

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
   * only found inside one specific place, which is how Bix and Renn share Holo
   * Hollow without either appearing merely because the player is in town.
   */
  localPlaceId?: LocalPlaceId;
  /**
   * Authored, Mission-derived placements, in authored order (#190, #231).
   *
   * The home placement above is where the NPC is before any of these apply.
   * Each entry names the durable Mission completion that sends the NPC to a
   * new placement, and the latest entry in this list whose Mission the
   * character has completed decides where the NPC is now; later entries win
   * over earlier ones regardless of which Mission happened to finish first.
   *
   * Wade is at the Crash Site until Keep the Change completes and at his own
   * yard afterwards. That is one NPC in several places over time, derived from
   * the Mission record that already decides it — never a second "shop Wade",
   * and never a persisted relocation flag that could disagree with the Mission.
   *
   * This is story placement only, not an NPC schedule, shift, or movement
   * engine: nothing here reads the clock, and a story beat that moves somebody
   * earns its own authored entry.
   */
  relocations?: readonly NpcRelocation[];
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
    relocations: [
      {
        afterCompletedMissionId: MISSION_IDS.keepTheChange,
        locationId: LOCATION_IDS.ruskRecovery,
        conversationBackgroundId: CONVERSATION_BACKGROUND_IDS.ruskRecoveryYard,
      },
    ],
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

/**
 * The authored relocation currently in effect for one NPC, if any (#231).
 *
 * The latest entry in authored order whose Mission is complete wins. Missions
 * that no entry names never matter, and an NPC with no completed entry is at
 * their home placement.
 */
function activeRelocation(
  npc: NpcDefinition,
  completedMissionIds: ReadonlySet<string>,
): NpcRelocation | undefined {
  const relocations = npc.relocations ?? [];
  for (let index = relocations.length - 1; index >= 0; index -= 1) {
    const relocation = relocations[index]!;
    if (completedMissionIds.has(relocation.afterCompletedMissionId)) return relocation;
  }
  return undefined;
}

/** Where one NPC is right now, given the character's completed Missions (#190, #231). */
export function resolveNpcPlacement(
  npc: NpcDefinition,
  completedMissionIds: ReadonlySet<string> = new Set(),
): { locationId: LocationId; localPlaceId?: LocalPlaceId } {
  const relocation = activeRelocation(npc, completedMissionIds);
  if (relocation) {
    return {
      locationId: relocation.locationId,
      ...(relocation.localPlaceId ? { localPlaceId: relocation.localPlaceId } : {}),
    };
  }
  return {
    locationId: npc.homeLocationId,
    ...(npc.localPlaceId ? { localPlaceId: npc.localPlaceId } : {}),
  };
}

/**
 * The background a present-tense local conversation with one NPC plays against.
 *
 * Only sequences authored as `presentsAtCurrentVenue` — replayable topics and
 * post-Mission follow-ups — consult this, and it is derived from the same
 * relocation that decides where the person is standing, so there is no second
 * source of truth and nothing new is persisted. An NPC who has not moved — or
 * whose current relocation authors no venue of its own — resolves the
 * background they were already authored against, which is why this changes
 * nothing for everybody else.
 */
export function resolveNpcVenueBackgroundId(
  npc: NpcDefinition,
  completedMissionIds: ReadonlySet<string> = new Set(),
): ConversationBackgroundId | undefined {
  return (
    activeRelocation(npc, completedMissionIds)?.conversationBackgroundId ??
    npc.conversationBackgroundId
  );
}

/**
 * Every persistent resident of one exact spatial context, in authored roster
 * order (#159, #231).
 *
 * A World Location without an active Local Place resolves the NPCs who have no
 * Local Place of their own there — Wade, Tansy, and every ordinary location.
 * Supplying a Local Place resolves that place's own residents instead, which is
 * how Bix and Renn occupy one shared World Location without either being
 * exposed merely for standing in town. The match is exact on both halves, so a
 * Local Place's resident never bleeds into its parent World Location and a
 * World Location's resident never appears inside one of its places.
 *
 * Placement is resolved per NPC through `resolveNpcPlacement`, so an authored
 * Mission-derived move is simply where that person is now. The caller supplies
 * the character's completed Missions; omitting them resolves the pre-story
 * placement, which is the correct answer for a character who has completed
 * nothing.
 *
 * The order is the roster's authored order, never completion or arrival order,
 * so the same state always presents the same people in the same sequence. Each
 * roster entry is one NPC, so nobody appears twice. `roster` exists for tests
 * that prove the rule against synthetic NPCs; gameplay reads the real roster.
 *
 * This is presentation of who is standing here. It is not authority: every
 * gameplay command revalidates its own location server-side.
 */
export function getResidentNpcs(input: {
  locationId: string;
  localPlaceId?: string;
  completedMissionIds?: ReadonlySet<string>;
  roster?: readonly NpcDefinition[];
}): readonly NpcDefinition[] {
  return (input.roster ?? NPCS).filter((npc) => {
    const placement = resolveNpcPlacement(npc, input.completedMissionIds);
    return (
      placement.locationId === input.locationId && placement.localPlaceId === input.localPlaceId
    );
  });
}

export function resolveNpcExpression(npcId: string, expressionId: string): string | undefined {
  return getNpc(npcId)?.expressionAssets?.[expressionId as ExpressionId];
}
