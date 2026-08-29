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
      DIALOGUE_IDS.wadeWalkItOffActiveFollowUp,
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
    // appears. Completed presentation is one-shot and never reused as idle
    // (issue #129), so the unreachable gated state yields no completed
    // fallback — Tansy shows nothing until the CYT offer becomes available.
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [
        wio("completed"),
        cyt("not_accepted", undefined, false),
      ])?.sequence.id,
    ).toBeUndefined();
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
    ).toBe(DIALOGUE_IDS.tansyPostCutYourTeeth);
  });

  it("Issue #129: Wade active WIO follow-up does not claim the Cutter was received", () => {
    const active = resolveNpcMissionDialogue(NPC_IDS.wadeRusk, [wio("active")])?.sequence;
    expect(active?.id).toBe(DIALOGUE_IDS.wadeWalkItOffActiveFollowUp);
    const text = active?.beats.map((b) => b.text).join(" ") ?? "";
    expect(text.toLowerCase()).not.toContain("cutter");
    expect(text).toContain("The Jag");
    expect(text).toContain("The Long Scramble");
    expect(text.toLowerCase()).toContain("scaveng");
  });

  it("Issue #129: after WIO completed (no later superseding), Wade shows completed-WIO Cutter follow-up", () => {
    expect(resolveNpcMissionDialogue(NPC_IDS.wadeRusk, [wio("completed")])?.sequence.id).toBe(
      DIALOGUE_IDS.wadeFollowUp,
    );
  });

  it("Issue #129: after CYT completed, Tansy and Wade resolve post-CYT story dialogue, not replayed presentation", async () => {
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [wio("completed"), cyt("completed")])?.sequence
        .id,
    ).toBe(DIALOGUE_IDS.tansyPostCutYourTeeth);
    expect(
      resolveNpcMissionDialogue(NPC_IDS.wadeRusk, [wio("completed"), cyt("completed")])?.sequence
        .id,
    ).toBe(DIALOGUE_IDS.wadePostCutYourTeeth);
    const { getMissionCompletionPresentation } = await import("@/game/content/dialogue");
    expect(getMissionCompletionPresentation(MISSION_IDS.cutYourTeeth)?.id).toBe(
      DIALOGUE_IDS.tansyCutYourTeethCompletion,
    );
  });

  it("Issue #129: generic newest/furthest completed-story routing with real fallback semantics", async () => {
    const { getMissionCompletionPresentation: gcp } = await import("@/game/content/dialogue");
    // Completion presentation is one-shot — not returned by the router after CYT completed.
    expect(gcp("cut_your_teeth")?.id).toBe(DIALOGUE_IDS.tansyCutYourTeethCompletion);
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [wio("completed"), cyt("completed")])?.sequence
        .id,
    ).not.toBe(DIALOGUE_IDS.tansyCutYourTeethCompletion);

    // Newest completed that authors Wade wins over earlier WIO completed.
    expect(
      resolveNpcMissionDialogue(NPC_IDS.wadeRusk, [wio("completed"), cyt("completed")])?.sequence
        .id,
    ).toBe(DIALOGUE_IDS.wadePostCutYourTeeth);

    // Generic fallback: synthesize a later completed mission that has no Wade
    // dialogue — router must fall back to the nearest earlier completed that does.
    // A projection whose missionId has no definition is skipped (newest-first scan).
    const syntheticFutureCompleted = p("synthetic_future_no_wade" as any, "completed");
    expect(
      resolveNpcMissionDialogue(NPC_IDS.wadeRusk, [
        wio("completed"),
        cyt("completed"),
        syntheticFutureCompleted,
      ])?.sequence.id,
    ).toBe(DIALOGUE_IDS.wadePostCutYourTeeth);

    // Conversely, when the synthetic future DOES author Wade (inject a real
    // later definition temporarily), the newest wins. Proved by the real
    // WIO→CYT chain already: CYT (newer) wins over WIO for Wade.
    expect(resolveNpcMissionDialogue(NPC_IDS.wadeRusk, [wio("completed")])?.sequence.id).toBe(
      DIALOGUE_IDS.wadeFollowUp,
    );
    expect(
      resolveNpcMissionDialogue(NPC_IDS.wadeRusk, [wio("completed"), cyt("completed")])?.sequence
        .id,
    ).toBe(DIALOGUE_IDS.wadePostCutYourTeeth);
  });

  it("WIO completed + CYT completed: Tansy shows ordinary post-CYT story dialogue (presentation is one-shot)", () => {
    expect(
      resolveNpcMissionDialogue(NPC_IDS.tansyRusk, [wio("completed"), cyt("completed")])?.sequence
        .id,
    ).toBe(DIALOGUE_IDS.tansyPostCutYourTeeth);
  });
});
