import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, lapidaryRecipes } from "@/game/config/balance";
import {
  ACTION_IDS,
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  NPC_IDS,
} from "@/game/config/foundations";
import { LAPIDARY_WORKBENCH } from "@/game/content/lapidary";
import {
  THEYRE_MINERALS_MARIE as M,
  MISSIONS,
  type MissionDefinition,
} from "@/game/content/missions";
import { merchantBuybackPrice } from "@/game/content/merchants";
import {
  missionActivityAccess,
  validateMissionActivityAccess,
} from "@/game/domain/activity-access";
import { resolveCrafting } from "@/game/domain/deterministic-crafting";
import { activeMissionStage, missionProgressKey } from "@/game/domain/mission-stages";
import {
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
} from "@/game/domain/missions";
import { resolveNpcConversation, resolveMissionSuccessView } from "@/game/domain/conversation";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const acceptedAt = new Date("2026-10-28T00:00:00Z");
const observation: MissionObservation = {
  equippedItemIds: new Set(),
  carriedQuantities: new Map(),
  stackLimits: new Map(),
  itemNames: new Map(),
};
const history = (n: number) => M.stages!.slice(0, n).map((stage) => stage.id);
const projection = (n: number, progress = new Map<string, number>()) =>
  projectMission(M, { acceptedAt, completedStageIds: history(n) }, LOCATION_IDS.wernersLab, true, {
    ...observation,
    trackedProgress: progress,
  });

describe("Lapidary and reusable linear Mission phases", () => {
  it("validates the production registry and its declarative activity policy", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
    expect(() =>
      validateMissionActivityAccess(
        LAPIDARY_WORKBENCH.access,
        M,
        lapidaryRecipes().map((r) => r.actionId),
      ),
    ).not.toThrow();
  });
  it.each([0, 1, 2, 3])("exposes only the active objective set at phase %i", (n) => {
    const p = projection(n);
    expect(p.stage?.id).toBe(M.stages![n]!.id);
    expect(p.requirements?.map((r) => r.objective)).toEqual(
      M.stages![n]!.requirements.map((r) =>
        r.objective.replace("{current}", "0").replace("{target}", "1"),
      ),
    );
    expect(p.state).toBe(n === 3 ? "ready_for_completion" : "active");
    expect(p.guidance?.actionId).toBe(
      n === 0 ? ACTION_IDS.shapeStone : n === 2 ? ACTION_IDS.cutQuartz : undefined,
    );
    if (n === 1 || n === 3) expect(p.guidance?.npcId).toBe(NPC_IDS.werner);
  });
  it("scopes progress so a later stage never reads an earlier stage's marker", () => {
    const p = projection(2, new Map([[missionProgressKey(M.stages![0], "cut-quartz"), 99]]));
    expect(p.requirements?.[0]?.satisfied).toBe(false);
    expect(p.requirements?.[0]?.progress?.current).toBe(0);
  });
  it("routes the mandatory middle conversation before the same NPC's final turn-in", () => {
    const entries = resolveNpcConversation(NPC_IDS.werner, [projection(1)]);
    const mission = entries.find((entry) => entry.kind === "mission");
    expect(mission).toMatchObject({
      dialogueId: DIALOGUE_IDS.wernerQuartzLesson,
      action: { kind: "acknowledge_conversation" },
    });
  });
  it("shows a stage gift only from a successful transition receipt", () => {
    const input = {
      actionKind: "acknowledge_conversation" as const,
      missionId: M.id,
      dialogueId: DIALOGUE_IDS.wernerQuartzLesson,
    };
    expect(
      resolveMissionSuccessView({ ...input, mission: { status: "already_acknowledged" } }),
    ).toEqual({ kind: "hub" });
    expect(
      resolveMissionSuccessView({
        ...input,
        mission: {
          status: "acknowledged",
          stageTransition: {
            completedStageId: M.stages![1]!.id,
            activeStageId: M.stages![2]!.id,
            presentationDialogueId: DIALOGUE_IDS.wernerQuartzGranted,
          },
        },
      }),
    ).toEqual({ kind: "dialogue", dialogueId: DIALOGUE_IDS.wernerQuartzGranted });
  });
  it.each([
    { completedStageIds: [] },
    { completedStageIds: [M.stages![1]!.id] },
    { completedStageIds: [M.stages![0]!.id, M.stages![0]!.id] },
  ])("fails closed for malformed history %j", ({ completedStageIds }) => {
    if (completedStageIds.length === 0)
      return expect(() =>
        activeMissionStage(M, { acceptedAt, completedAt: acceptedAt, completedStageIds }),
      ).toThrow();
    expect(() => activeMissionStage(M, { acceptedAt, completedStageIds })).toThrow();
  });
  it("derives locked, single-unit supervised and permanent permissions from durable Mission state", () => {
    expect(missionActivityAccess(LAPIDARY_WORKBENCH.access, M)).toEqual({ kind: "locked" });
    for (let n = 0; n < 4; n++)
      expect(
        missionActivityAccess(LAPIDARY_WORKBENCH.access, M, {
          acceptedAt,
          completedStageIds: history(n),
        }).kind,
      ).toBe(n === 0 || n === 2 ? "supervised" : "locked");
    expect(
      missionActivityAccess(LAPIDARY_WORKBENCH.access, M, {
        acceptedAt,
        completedAt: acceptedAt,
        completedStageIds: history(4),
      }),
    ).toEqual({ kind: "unrestricted" });
  });
  it.each([
    { ...M, stages: [] },
    { ...M, stages: [M.stages![0]!, M.stages![0]!] },
    {
      ...M,
      stages: M.stages!.map((stage, i) =>
        i === 0 ? { ...stage, onAdvance: M.stages![1]!.onAdvance } : stage,
      ),
    },
    { ...M, requirements: M.stages![0]!.requirements },
  ])("rejects invalid generic stage authoring", (definition) =>
    expect(() => validateMissionDefinitions([definition as MissionDefinition])).toThrow(),
  );
  it("accepts a second staged definition with stage-only reminders and two distinct conversations at the same NPC", () => {
    const definition: MissionDefinition = {
      ...M,
      id: "test_generic_stages",
      stages: [
        {
          id: "first-work",
          title: "First work",
          requirements: M.stages![0]!.requirements,
          dialogue: { trackedActivityReminderDialogueId: DIALOGUE_IDS.wernerStoneReminder },
        },
        { id: "first-meeting", title: "First meeting", requirements: M.stages![1]!.requirements },
        {
          id: "second-meeting",
          title: "Second meeting",
          requirements: [
            {
              ...M.stages![1]!.requirements[0]!,
              progressKey: "second-meeting",
              dialogueId: DIALOGUE_IDS.wernerGraduation,
            } as Extract<(typeof M.requirements)[number], { kind: "npc_conversation" }>,
          ],
        },
        { id: "final", title: "Final", requirements: [] },
      ],
      dialogue: {
        busyDialogueId: DIALOGUE_IDS.wernerBusy,
        completionPresentationDialogueId: DIALOGUE_IDS.wernerCompleted,
        conversationReminderDialogueId: DIALOGUE_IDS.wernerQuartzLesson,
      },
    };
    expect(() => validateMissionDefinitions([definition])).not.toThrow();
    const p = projectMission(
      definition,
      { acceptedAt, completedStageIds: ["first-work", "first-meeting"] },
      LOCATION_IDS.wernersLab,
      true,
      observation,
    );
    expect(p.requirements).toHaveLength(1);
    expect(p.requirements?.[0]?.satisfied).toBe(false);
  });
  it("rejects an unknown stage-only reminder and duplicate mandatory NPCs inside one phase", () => {
    for (const stages of [
      M.stages!.map((stage, i) =>
        i === 0
          ? { ...stage, dialogue: { trackedActivityReminderDialogueId: "missing-stage-dialogue" } }
          : stage,
      ),
      M.stages!.map((stage, i) =>
        i === 1
          ? {
              ...stage,
              requirements: [
                ...stage.requirements,
                {
                  ...stage.requirements[0]!,
                  progressKey: "second-conversation",
                  dialogueId: DIALOGUE_IDS.wernerGraduation,
                } as Extract<(typeof M.requirements)[number], { kind: "npc_conversation" }>,
              ],
            }
          : stage,
      ),
    ])
      expect(() => validateMissionDefinitions([{ ...M, stages }])).toThrow();
  });
  it("Shape Stone is a guaranteed no-output committed cycle, never an invented item", () => {
    const recipe = getEffectiveGameBalance().lapidary.recipes.shapeStone;
    const snapshot = {
      skillLevel: 1,
      stacks: [{ id: "stone", itemId: ITEM_IDS.stone, quantity: 2 }],
      slotsAvailable: 0,
      massAvailableGrams: 0,
      allowance: { remaining: 1, exhaustedReason: "run_completed" as const },
      finishCurrent: false,
    };
    expect(resolveCrafting({ elapsedTicks: 19, snapshot, recipe }).awardedXp).toBe(0);
    const done = resolveCrafting({ elapsedTicks: 6000, snapshot, recipe });
    expect(done.resolved).toHaveLength(1);
    expect(done.awardedXp).toBe(15);
    expect(done.outputsGained).toEqual({});
    expect(done.inputsConsumed).toEqual({ [ITEM_IDS.stone]: 1 });
    expect(
      resolveCrafting({ elapsedTicks: 6000, snapshot: { ...snapshot, authorized: false }, recipe })
        .resolved,
    ).toHaveLength(0);
    expect(
      resolveCrafting({
        elapsedTicks: 6000,
        snapshot: { ...snapshot, allowance: { ...snapshot.allowance, remaining: 0 } },
        recipe,
      }).resolved,
    ).toHaveLength(0);
  });
  it("uses the locked art master and authored Quartz economy", () => {
    const bytes = readFileSync("assets/item-art/cut-quartz.png");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "2a38007a0963f449aef58fe8e776c9a709e336deb604d179354bfd20eb9e422c",
    );
    expect(getEffectiveGameBalance().items.cutQuartz).toMatchObject({
      massGrams: 100,
      stackLimit: 2,
    });
    expect(merchantBuybackPrice(MERCHANT_IDS.wernerLab, ITEM_IDS.cutQuartz)).toBe(16);
  });
});
