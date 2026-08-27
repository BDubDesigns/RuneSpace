import { describe, expect, it } from "vitest";
import { MISSION_IDS, NPC_IDS, DIALOGUE_IDS } from "@/game/config/foundations";
import { resolveNpcMissionDialogue, type NpcDialogueProjection } from "@/game/content/dialogue";

function p(
  missionId: string,
  state: NpcDialogueProjection["state"],
  stage?: NpcDialogueProjection["stage"],
  prereq = true,
): NpcDialogueProjection {
  return {
    missionId,
    state,
    prerequisiteSatisfied: prereq,
    stage: stage ?? { requirementsSatisfied: false, turnInAvailable: false },
  };
}

describe("router matrix parity", () => {
  const wio = (state: NpcDialogueProjection["state"], stage?: NpcDialogueProjection["stage"]) =>
    p(MISSION_IDS.walkItOff, state, stage);
  const cyt = (
    state: NpcDialogueProjection["state"],
    stage?: NpcDialogueProjection["stage"],
    prereq = true,
  ) => p(MISSION_IDS.cutYourTeeth, state, stage, prereq);

  it("Wade: offer when WIO not accepted, follow-up after", () => {
    expect(resolveNpcMissionDialogue(NPC_IDS.wadeRusk, [wio("not_accepted")])?.sequence.id).toBe(
      DIALOGUE_IDS.wadeOffer,
    );
    expect(resolveNpcMissionDialogue(NPC_IDS.wadeRusk, [wio("active")])?.sequence.id).toBe(
      DIALOGUE_IDS.wadeFollowUp,
    );
    expect(
      resolveNpcMissionDialogue(NPC_IDS.wadeRusk, [wio("completed"), cyt("active")])?.sequence.id,
    ).toBe(DIALOGUE_IDS.wadeFollowUp);
  });

  it("Tansy: explorer offer → completion → after-remote-acceptance stays available", () => {
    expect(resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [wio("not_accepted")])?.sequence.id).toBe(
      DIALOGUE_IDS.tansyBeforeMission,
    );
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [wio("not_accepted")])
        ?.acceptedContinuationDialogueId,
    ).toBe(DIALOGUE_IDS.tansyAfterRemoteAcceptance);
    expect(resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [wio("active")])?.sequence.id).toBe(
      DIALOGUE_IDS.tansyCompletion,
    );
  });

  it("Tansy: CYT offer once WIO completed; CYT stage branches while active", () => {
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [wio("completed"), cyt("not_accepted")])
        ?.sequence.id,
    ).toBe(DIALOGUE_IDS.tansyCutYourTeethOffer);
    // Availability derives from the PROJECTION, never hardcoded: when the
    // projection reports the prerequisite unsatisfied, the offer never
    // appears (an unreachable-but-safe fallback shows the prior completion).
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [
        wio("completed"),
        cyt("not_accepted", undefined, false),
      ])?.sequence.id,
    ).toBe(DIALOGUE_IDS.tansyAfterClaim);
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [
        wio("completed"),
        cyt("active", {
          requirementsSatisfied: false,
          turnInAvailable: false,
          nextObjectiveKind: "equipped_item",
        }),
      ])?.sequence.id,
    ).toBe(DIALOGUE_IDS.tansyCutYourTeethEquipReminder);
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [
        wio("completed"),
        cyt("active", {
          requirementsSatisfied: false,
          turnInAvailable: false,
          nextObjectiveKind: "carried_stack",
        }),
      ])?.sequence.id,
    ).toBe(DIALOGUE_IDS.tansyCutYourTeethStackReminder);
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [
        wio("completed"),
        cyt("active", { requirementsSatisfied: true, turnInAvailable: false }),
      ])?.sequence.id,
    ).toBe(DIALOGUE_IDS.tansyCutYourTeethBusy);
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [
        wio("completed"),
        cyt("ready_for_completion", { requirementsSatisfied: true, turnInAvailable: true }),
      ])?.sequence.id,
    ).toBe(DIALOGUE_IDS.tansyCutYourTeethTurnIn);
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [wio("completed"), cyt("completed")])?.sequence
        .id,
    ).toBe(DIALOGUE_IDS.tansyCutYourTeethCompletion);
  });

  it("WIO completed + CYT completed: Tansy shows the newest completion presentation", () => {
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [wio("completed"), cyt("completed")])?.sequence
        .id,
    ).toBe(DIALOGUE_IDS.tansyCutYourTeethCompletion);
  });
});
