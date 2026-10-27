import {
  ITEM_IDS,
  RESEARCH_JOB_IDS,
  type ItemId,
  type ResearchJobId,
} from "@/game/config/foundations";

/**
 * The explicit opt-in list of bound Mission items a player may Destroy from
 * Inventory Item Details (#408). Being unique, bound, untradeable or
 * Mission-related never makes an item destroyable: an item is destroyable only
 * when it has an entry here, and destroying it always means the cancellation its
 * entry names. The client shows the action from this list and the server
 * rechecks it inside the character lock; neither names an item of its own.
 *
 * Adopting a new item is one entry, plus a `cancels` kind only if its Mission
 * is not a research assignment (the server owns the transaction for each kind).
 */
export type MissionItemDestroyPolicy = {
  itemId: ItemId;
  /** The run that owns the item, ended in the same transaction that deletes it. */
  cancels: { kind: "research_assignment"; jobId: ResearchJobId };
  /** What the player permanently loses beyond the item and the progress, in the confirmation. */
  forfeits: string;
};

export const MISSION_ITEM_DESTROY_POLICIES: readonly MissionItemDestroyPolicy[] = [
  {
    itemId: ITEM_IDS.sealedResearchPacket,
    cancels: { kind: "research_assignment", jobId: RESEARCH_JOB_IDS.researchCourier },
    forfeits: "the 25 Credits payment",
  },
  {
    itemId: ITEM_IDS.geologicalSampleCase,
    cancels: { kind: "research_assignment", jobId: RESEARCH_JOB_IDS.geologicalFieldSurvey },
    forfeits: "the 75 Credits payment",
  },
  {
    itemId: ITEM_IDS.resonanceSampler,
    cancels: { kind: "research_assignment", jobId: RESEARCH_JOB_IDS.resonanceCalibration },
    forfeits: "the free passage to Skatboll",
  },
];

const policyByItemId = new Map<string, MissionItemDestroyPolicy>(
  MISSION_ITEM_DESTROY_POLICIES.map((policy) => [policy.itemId, policy]),
);

export function getMissionItemDestroyPolicy(itemId: string): MissionItemDestroyPolicy | undefined {
  return policyByItemId.get(itemId);
}

/** Copy shared by the confirmation and its result, so the two always agree. */
export const MISSION_ITEM_DESTROY_COPY = {
  action: "Destroy",
  keep: "KEEP ITEM",
  confirm: "DESTROY & ABANDON",
} as const;
