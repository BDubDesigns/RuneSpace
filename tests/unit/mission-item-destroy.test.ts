import { describe, expect, it } from "vitest";
import { ITEM_IDS, RESEARCH_JOB_IDS } from "@/game/config/foundations";
import {
  MISSION_ITEM_DESTROY_POLICIES,
  getMissionItemDestroyPolicy,
} from "@/game/content/mission-item-destroy";
import { RESEARCH_JOBS, getResearchJob } from "@/game/content/research-jobs";
import {
  missionItemDestroyOffer,
  validateResearchJobs,
  type ResearchAssignmentProjection,
} from "@/game/domain/research-jobs";

function run(
  jobId: string,
  overrides: Partial<ResearchAssignmentProjection> = {},
): ResearchAssignmentProjection {
  return {
    assignmentId: "run-1",
    jobId,
    stage: "field",
    loanItemHeld: true,
    loanItemInstanceId: "item-1",
    delivered: false,
    recorded: false,
    sampledLocationIds: [],
    progress: { current: 0, target: 1 },
    ...overrides,
  };
}

describe("Mission item destroy policy (#408)", () => {
  it("opts in exactly the three research loans, each to its own job", () => {
    expect(MISSION_ITEM_DESTROY_POLICIES.map((policy) => policy.itemId).sort()).toEqual(
      [
        ITEM_IDS.sealedResearchPacket,
        ITEM_IDS.geologicalSampleCase,
        ITEM_IDS.resonanceSampler,
      ].sort(),
    );
    for (const policy of MISSION_ITEM_DESTROY_POLICIES) {
      expect(getResearchJob(policy.cancels.jobId)?.loanItemId).toBe(policy.itemId);
    }
    expect(() => validateResearchJobs()).not.toThrow();
  });

  it("is not granted by being unique, bound or a research item", () => {
    expect(getMissionItemDestroyPolicy(ITEM_IDS.salvageCutter)).toBeUndefined();
    expect(getMissionItemDestroyPolicy(ITEM_IDS.powerCell)).toBeUndefined();
    expect(getMissionItemDestroyPolicy("made_up_item")).toBeUndefined();
  });

  it("names a concrete loss for each job", () => {
    expect(getMissionItemDestroyPolicy(ITEM_IDS.sealedResearchPacket)?.forfeits).toContain("25");
    expect(getMissionItemDestroyPolicy(ITEM_IDS.geologicalSampleCase)?.forfeits).toContain("75");
    expect(getMissionItemDestroyPolicy(ITEM_IDS.resonanceSampler)?.forfeits).toContain("Skatboll");
  });
});

describe("missionItemDestroyOffer", () => {
  it.each(RESEARCH_JOBS.map((job) => [job.id, job.loanItemId] as const))(
    "offers %s only for the exact held instance",
    (jobId, itemId) => {
      const offer = missionItemDestroyOffer(run(jobId), { id: "item-1", itemId });
      expect(offer).toMatchObject({ assignmentId: "run-1", job: { id: jobId } });
      expect(missionItemDestroyOffer(run(jobId), { id: "item-2", itemId })).toBeUndefined();
    },
  );

  it("offers nothing without a run, without a held loan or for a different job's item", () => {
    const item = { id: "item-1", itemId: ITEM_IDS.sealedResearchPacket };
    expect(missionItemDestroyOffer(undefined, item)).toBeUndefined();
    expect(
      missionItemDestroyOffer(run(RESEARCH_JOB_IDS.researchCourier, { loanItemHeld: false }), item),
    ).toBeUndefined();
    expect(
      missionItemDestroyOffer(run(RESEARCH_JOB_IDS.geologicalFieldSurvey), item),
    ).toBeUndefined();
    expect(
      missionItemDestroyOffer(run(RESEARCH_JOB_IDS.researchCourier), {
        id: "item-1",
        itemId: ITEM_IDS.salvageCutter,
      }),
    ).toBeUndefined();
  });
});
