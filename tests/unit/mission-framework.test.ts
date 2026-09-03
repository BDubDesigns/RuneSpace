import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTION_IDS,
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { getActionOutputItemIds } from "@/game/domain/action-outputs";
import { miningAwardFacts } from "@/game/domain/mining";
import { refiningAwardFacts } from "@/game/domain/refining";
import { asContentId, type ContentId } from "@/game/schemas/ids";
import {
  CUT_YOUR_TEETH,
  MISSIONS,
  WALK_IT_OFF,
  type MissionDefinition,
} from "@/game/content/missions";
import {
  deriveMissionGuidanceTargets,
  projectMission,
  validateMissionDefinitions,
} from "@/game/domain/missions";
import { AcceptMissionRequestSchema, CompleteMissionRequestSchema } from "@/game/schemas/gameplay";

function definitionOf(overrides: Partial<MissionDefinition>): MissionDefinition {
  return { ...WALK_IT_OFF, continuationMissionId: undefined, ...overrides } as MissionDefinition;
}

describe("issue #124 mission registry validation", () => {
  it("accepts the authored production registry", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
  });

  it("rejects a mission without any authored offer", () => {
    expect(() => validateMissionDefinitions([definitionOf({ offers: [] })])).toThrow(/offer/i);
  });

  it("rejects an unknown prerequisite and a self-prerequisite", () => {
    expect(() =>
      validateMissionDefinitions([
        definitionOf({ prerequisiteMissionId: "no_such_mission" as ContentId }),
      ]),
    ).toThrow(/prerequisite/i);
    expect(() =>
      validateMissionDefinitions([definitionOf({ prerequisiteMissionId: MISSION_IDS.walkItOff })]),
    ).toThrow(/own prerequisite/i);
  });

  it("rejects a carried requirement that targets a unique item", () => {
    expect(() =>
      validateMissionDefinitions([
        definitionOf({
          requirements: [
            {
              kind: "carried_stack",
              itemId: ITEM_IDS.salvageCutter,
              turnIn: "show",
              objective: "Carry the {item}",
            },
          ],
        }),
      ]),
    ).toThrow(/stackable/i);
  });

  it("rejects a carried quantity above the authoritative stack limit", () => {
    expect(() =>
      validateMissionDefinitions([
        definitionOf({
          requirements: [
            {
              kind: "carried_stack",
              itemId: ITEM_IDS.ferriteShale,
              quantity: 99,
              turnIn: "show",
              objective: "Carry {required} {item}",
            },
          ],
        }),
      ]),
    ).toThrow(/stack limit/i);
  });

  it("rejects a recommended acquisition action that does not authoritatively produce the item", () => {
    // Mining produces Ferrite Shale, never Power Cells — the recommendation
    // must validate against the authoritative action outputs, not a
    // duplicated drop table.
    expect(() =>
      validateMissionDefinitions([
        definitionOf({
          requirements: [
            {
              kind: "carried_stack",
              itemId: ITEM_IDS.powerCell,
              turnIn: "show",
              objective: "Carry {item}",
              recommendedActionId: ACTION_IDS.ferriteShaleMining,
            },
          ],
        }),
      ]),
    ).toThrow(/does not authoritatively produce/i);
    // And an action whose outputs DO cover the item passes validation.
    expect(() =>
      validateMissionDefinitions([
        definitionOf({
          requirements: [
            {
              kind: "carried_stack",
              itemId: ITEM_IDS.ferriteShale,
              turnIn: "show",
              objective: "Carry {item}",
              recommendedActionId: ACTION_IDS.ferriteShaleMining,
            },
          ],
        }),
      ]),
    ).not.toThrow();
  });

  it("rejects an unknown reward item or skill without an approved curve", () => {
    expect(() =>
      validateMissionDefinitions([
        definitionOf({ reward: { kind: "item", itemId: "ghost_item" as ContentId } }),
      ]),
    ).toThrow(/reward/i);
    expect(() =>
      validateMissionDefinitions([
        definitionOf({
          reward: {
            kind: "skill_xp",
            skillId: "strength" as (typeof SKILL_IDS)[keyof typeof SKILL_IDS],
            amount: 10,
          },
        }),
      ]),
    ).toThrow(/progression curve/i);
  });

  it("rejects an activeDialogueId whose dialogue belongs to a different NPC", () => {
    expect(() =>
      validateMissionDefinitions([
        definitionOf({
          offers: [
            {
              npcId: NPC_IDS.wadeRusk,
              locationId: LOCATION_IDS.crashSite,
              dialogueId: DIALOGUE_IDS.wadeOffer,
              activeDialogueId: DIALOGUE_IDS.tansyCutYourTeethOffer,
            },
          ],
        }),
      ]),
    ).toThrow(/belongs to NPC/i);
    expect(() =>
      validateMissionDefinitions([
        definitionOf({
          offers: [
            {
              npcId: NPC_IDS.wadeRusk,
              locationId: LOCATION_IDS.crashSite,
              dialogueId: DIALOGUE_IDS.wadeOffer,
              activeDialogueId: DIALOGUE_IDS.wadeWalkItOffActiveFollowUp,
            },
          ],
        }),
      ]),
    ).not.toThrow();
  });

  it("rejects a completedNpcDialogue whose dialogue belongs to a different NPC", () => {
    expect(() =>
      validateMissionDefinitions([
        definitionOf({
          completedNpcDialogue: [
            { npcId: NPC_IDS.wadeRusk, dialogueId: DIALOGUE_IDS.tansyPostCutYourTeeth },
          ],
        }),
      ]),
    ).toThrow(/belongs to NPC/i);
    expect(() =>
      validateMissionDefinitions([
        definitionOf({
          completedNpcDialogue: [
            { npcId: NPC_IDS.tansyRusk, dialogueId: DIALOGUE_IDS.tansyCutYourTeethCompletion },
          ],
        }),
      ]),
    ).not.toThrow();
  });

  it("rejects a stackable item reward: validation and runtime capability must agree", () => {
    // Ferrite Shale is stackable; the generic completion boundary executes
    // item rewards only as one new unique instance. A stackable reward would
    // pass validation and throw at runtime — it must fail fast here.
    expect(() =>
      validateMissionDefinitions([
        definitionOf({ reward: { kind: "item", itemId: ITEM_IDS.ferriteShale } }),
      ]),
    ).toThrow(/unique item/);
    // The proven unique-item shape still validates.
    expect(() =>
      validateMissionDefinitions([
        definitionOf({ reward: { kind: "item", itemId: ITEM_IDS.salvageCutter } }),
      ]),
    ).not.toThrow();
  });
});

describe("issue #124 action-output capability check shares the gameplay truth", () => {
  it("derives outputs from the resolvers' award facts, not a parallel table", () => {
    const balance = getEffectiveGameBalance();
    // The capability check reads exactly what the resolvers award: Mining's
    // single output item and Refining's two output items. Changing an
    // action's authoritative award changes this automatically — there is no
    // hand-maintained drop table to go stale.
    expect(getActionOutputItemIds(ACTION_IDS.ferriteShaleMining)).toEqual([
      miningAwardFacts(balance).itemId,
    ]);
    expect(getActionOutputItemIds(ACTION_IDS.refining)).toEqual(
      refiningAwardFacts(balance).outputs.map((output) => output.itemId),
    );
    // Actions with no material output resolve to undefined (e.g. Travel).
    expect(getActionOutputItemIds(ACTION_IDS.travel)).toBeUndefined();
  });
});

describe("issue #124 mission command schemas accept only identity/intent", () => {
  it("accepts the narrow characterId+missionId+npcId shape", () => {
    const parsed = AcceptMissionRequestSchema.safeParse({
      characterId: "0e9f5b2a-4c1d-4e8a-9b6f-2d3c4e5f6a7b",
      missionId: MISSION_IDS.walkItOff,
      npcId: NPC_IDS.tansyRusk,
    });
    expect(parsed.success).toBe(true);
    expect(
      CompleteMissionRequestSchema.safeParse({
        characterId: "0e9f5b2a-4c1d-4e8a-9b6f-2d3c4e5f6a7b",
        missionId: MISSION_IDS.cutYourTeeth,
        npcId: NPC_IDS.tansyRusk,
      }).success,
    ).toBe(true);
  });

  it("never carries client-supplied items, quantities, consume flags, or rewards", () => {
    // Forged gameplay fields are stripped by the schema — the server
    // revalidates everything from authored definitions and authoritative
    // state, so client-calculated values cannot influence the result.
    const forged = AcceptMissionRequestSchema.parse({
      characterId: "0e9f5b2a-4c1d-4e8a-9b6f-2d3c4e5f6a7b",
      missionId: MISSION_IDS.cutYourTeeth,
      npcId: NPC_IDS.tansyRusk,
      requiredItemId: ITEM_IDS.ferriteShale,
      requiredQuantity: 10,
      consume: true,
      reward: { kind: "skill_xp", skillId: SKILL_IDS.mining, amount: 9999 },
      prerequisiteSatisfied: true,
    });
    expect(Object.keys(forged).sort()).toEqual(["characterId", "missionId", "npcId"]);

    const forgedComplete = CompleteMissionRequestSchema.parse({
      characterId: "0e9f5b2a-4c1d-4e8a-9b6f-2d3c4e5f6a7b",
      missionId: MISSION_IDS.cutYourTeeth,
      npcId: NPC_IDS.tansyRusk,
      items: [{ itemId: ITEM_IDS.ferriteShale, quantity: 10 }],
      completionEligible: true,
    });
    expect(Object.keys(forgedComplete).sort()).toEqual(["characterId", "missionId", "npcId"]);
  });

  it("rejects malformed identity fields", () => {
    expect(
      AcceptMissionRequestSchema.safeParse({
        characterId: "not-a-uuid",
        missionId: MISSION_IDS.walkItOff,
        npcId: NPC_IDS.tansyRusk,
      }).success,
    ).toBe(false);
    expect(
      CompleteMissionRequestSchema.safeParse({
        characterId: "0e9f5b2a-4c1d-4e8a-9b6f-2d3c4e5f6a7b",
        missionId: "UPPER CASE ID!",
        npcId: NPC_IDS.tansyRusk,
      }).success,
    ).toBe(false);
  });
});

describe("issue #124 generic UI consumers", () => {
  it("contains no mission-ID branches or objective-prose parsing in features", () => {
    const featuresRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../features");
    const offenders: string[] = [];
    const missionIdLiterals = /walk_it_off|cut_your_teeth|walkItOff|cutYourTeeth|MISSION_IDS/;
    function scan(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const info = statSync(full);
        if (info.isDirectory()) {
          scan(full);
          continue;
        }
        if (!/\.(tsx?|jsx?)$/.test(entry)) continue;
        const text = readFileSync(full, "utf8");
        if (missionIdLiterals.test(text)) offenders.push(full);
      }
    }
    scan(featuresRoot);
    expect(offenders).toEqual([]);
  });
});

describe("mission-available vs mission-active guidance (issue #137: prerequisites never reveal)", () => {
  it("projects every authored offer location for a prerequisite-free mission", () => {
    const atCrashSite = projectMission(WALK_IT_OFF, undefined, LOCATION_IDS.crashSite, true);
    const atTheJag = projectMission(WALK_IT_OFF, undefined, LOCATION_IDS.theJag, true);
    expect(atCrashSite.guidance?.availableNpcIds).toEqual([NPC_IDS.wadeRusk]);
    expect(atTheJag.guidance?.availableNpcIds).toEqual([NPC_IDS.tansyRusk]);
    expect(atCrashSite.guidance?.npcId).toBeUndefined();
    expect(atTheJag.guidance?.npcId).toBeUndefined();
  });

  it("never advertises a prerequisite-gated mission, even when the prerequisite is satisfied", () => {
    const locked = projectMission(
      CUT_YOUR_TEETH,
      undefined,
      LOCATION_IDS.theJag,
      true,
      undefined,
      false,
    );
    expect(locked.guidance?.availableNpcIds).toBeUndefined();
    const prerequisiteSatisfied = projectMission(
      CUT_YOUR_TEETH,
      undefined,
      LOCATION_IDS.theJag,
      true,
      undefined,
      true,
    );
    expect(prerequisiteSatisfied.guidance?.availableNpcIds).toBeUndefined();
    expect(prerequisiteSatisfied.prerequisiteSatisfied).toBe(true);
  });

  it("removes available guidance once the mission is accepted and shows active progression", () => {
    const accepted = { acceptedAt: new Date("2026-01-01T00:00:00.000Z") };
    const activeAtCrashSite = projectMission(WALK_IT_OFF, accepted, LOCATION_IDS.crashSite, true);
    expect(activeAtCrashSite.guidance?.availableNpcIds).toBeUndefined();
    const activeAtTheJag = projectMission(WALK_IT_OFF, accepted, LOCATION_IDS.theJag, true);
    const targets = deriveMissionGuidanceTargets([activeAtTheJag]);
    expect([...targets.npcIds]).toEqual([NPC_IDS.tansyRusk]);
    expect([...targets.availableNpcIds]).toEqual([]);
  });

  it("keeps available and active guidance semantically distinct with active winning on overlap", () => {
    const overlap = deriveMissionGuidanceTargets([
      { guidance: { availableNpcIds: ["tansy_rusk"], npcId: "tansy_rusk" } } as any,
    ]);
    expect([...overlap.availableNpcIds]).toEqual(["tansy_rusk"]);
    expect([...overlap.npcIds]).toEqual(["tansy_rusk"]);
  });

  it("derives available guidance from every matching offer, not just the first", () => {
    const multiOffer: any = {
      id: "synthetic_multi_offer" as ContentId,
      title: "Synthetic",
      summary: "Test",
      offers: [
        {
          npcId: NPC_IDS.wadeRusk,
          locationId: LOCATION_IDS.crashSite,
          dialogueId: DIALOGUE_IDS.wadeOffer,
        },
        {
          npcId: NPC_IDS.tansyRusk,
          locationId: LOCATION_IDS.theJag,
          dialogueId: DIALOGUE_IDS.tansyBeforeMission,
        },
      ],
      requirements: [{ kind: "at_location", locationId: LOCATION_IDS.theJag, objective: "Go" }],
      turnIn: {
        npcId: NPC_IDS.tansyRusk,
        locationId: LOCATION_IDS.theJag,
        requiresStationary: true,
        objective: "Talk",
        dialogueId: DIALOGUE_IDS.tansyCompletion,
      },
      reward: { kind: "skill_xp", skillId: SKILL_IDS.mining, amount: 10 },
      dialogue: {},
    };
    const atCrashSite = projectMission(multiOffer, undefined, LOCATION_IDS.crashSite, true);
    const atTheJag = projectMission(multiOffer, undefined, LOCATION_IDS.theJag, true);
    const elsewhere = projectMission(multiOffer, undefined, "nowhere_else" as any, true);
    expect(atCrashSite.guidance?.availableNpcIds).toEqual([NPC_IDS.wadeRusk]);
    expect(atTheJag.guidance?.availableNpcIds).toEqual([NPC_IDS.tansyRusk]);
    expect(elsewhere.guidance?.availableNpcIds).toBeUndefined();
    expect(atCrashSite.guidance?.availableNpcIds).not.toContain(NPC_IDS.tansyRusk);
  });
});

describe("issue #137 authored mission continuation validation", () => {
  function basePair(): [MissionDefinition, MissionDefinition] {
    const first = definitionOf({ id: "synthetic_first" as ContentId });
    const second = definitionOf({
      id: "synthetic_second" as ContentId,
      prerequisiteMissionId: "synthetic_first" as ContentId,
    });
    return [first, second];
  }

  it("accepts an explicitly authored continuation into the prerequisite-gated next mission", () => {
    const [first, second] = basePair();
    expect(() =>
      validateMissionDefinitions([{ ...first, continuationMissionId: second.id }, second]),
    ).not.toThrow();
  });

  it("accepts the production Walk It Off → Cut Your Teeth continuation", () => {
    expect(WALK_IT_OFF.continuationMissionId).toBe(MISSION_IDS.cutYourTeeth);
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
  });

  it("rejects unknown and self continuations", () => {
    const [first, second] = basePair();
    expect(() =>
      validateMissionDefinitions([
        { ...first, continuationMissionId: "no_such_mission" as ContentId },
        second,
      ]),
    ).toThrow(/continuation/i);
    expect(() =>
      validateMissionDefinitions([{ ...first, continuationMissionId: first.id }, second]),
    ).toThrow(/itself/i);
  });

  it("rejects continuation cycles", () => {
    const [first, second] = basePair();
    expect(() =>
      validateMissionDefinitions([
        { ...first, continuationMissionId: second.id },
        {
          ...second,
          prerequisiteMissionId: undefined,
          continuationMissionId: first.id,
        },
      ]),
    ).toThrow(/cycle/i);
  });

  it("rejects a continuation that contradicts the target prerequisite", () => {
    const [first, second] = basePair();
    const third = definitionOf({
      id: "synthetic_third" as ContentId,
      prerequisiteMissionId: second.id,
    });
    expect(() =>
      validateMissionDefinitions([{ ...first, continuationMissionId: third.id }, second, third]),
    ).toThrow(/prerequisite/i);
  });
});

describe("issue #137 simultaneous current-stage requirement projection", () => {
  function cutYourTeethObservation(
    overrides: Partial<import("@/game/domain/missions").MissionObservation> = {},
  ): import("@/game/domain/missions").MissionObservation {
    return {
      equippedItemIds: new Set<string>(),
      carriedQuantities: new Map<string, number>(),
      stackLimits: new Map<string, number>([[ITEM_IDS.ferriteShale, 10]]),
      itemNames: new Map<string, string>([
        [ITEM_IDS.salvageCutter, "Salvage Cutter"],
        [ITEM_IDS.ferriteShale, "Ferrite Shale"],
      ]),
      ...overrides,
    };
  }

  const accepted = { acceptedAt: new Date("2026-01-01T00:00:00.000Z") };

  it("exposes all three Cut Your Teeth requirements with live satisfaction", () => {
    const projected = projectMission(
      CUT_YOUR_TEETH,
      accepted,
      LOCATION_IDS.theJag,
      true,
      cutYourTeethObservation({
        carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 4]]),
      }),
    );
    expect(projected.requirements).toHaveLength(3);
    expect(projected.requirements?.map((requirement) => requirement.kind)).toEqual([
      "at_location",
      "equipped_item",
      "carried_stack",
    ]);
    expect(projected.requirements?.map((requirement) => requirement.satisfied)).toEqual([
      true,
      false,
      false,
    ]);
    expect(projected.requirements?.[2]?.progress).toEqual({ carried: 4, required: 10 });
    expect(projected.requirements?.[2]?.objective).toBe(
      "Get a full stack of Ferrite Shale — 4 / 10",
    );
    expect(projected.stage?.nextObjectiveKind).toBe("equipped_item");
  });

  it("updates satisfaction and quantity when authoritative state changes", () => {
    const unequipped = projectMission(
      CUT_YOUR_TEETH,
      accepted,
      LOCATION_IDS.theJag,
      true,
      cutYourTeethObservation({
        equippedItemIds: new Set([ITEM_IDS.salvageCutter]),
        carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 4]]),
      }),
    );
    expect(unequipped.requirements?.[1]?.satisfied).toBe(true);
    expect(unequipped.requirements?.[2]?.progress).toEqual({ carried: 4, required: 10 });

    const regressed = projectMission(
      CUT_YOUR_TEETH,
      accepted,
      LOCATION_IDS.theJag,
      true,
      cutYourTeethObservation({
        carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 2]]),
      }),
    );
    expect(regressed.requirements?.[1]?.satisfied).toBe(false);
    expect(regressed.requirements?.[2]?.progress).toEqual({ carried: 2, required: 10 });
  });

  it("shows the turn-in objective when every requirement holds", () => {
    const projected = projectMission(
      CUT_YOUR_TEETH,
      accepted,
      LOCATION_IDS.theJag,
      true,
      cutYourTeethObservation({
        equippedItemIds: new Set([ITEM_IDS.salvageCutter]),
        carriedQuantities: new Map([[ITEM_IDS.ferriteShale, 10]]),
      }),
    );
    expect(projected.state).toBe("ready_for_completion");
    expect(projected.currentObjective).toBe("Show a full stack of Ferrite Shale to Tansy Rusk");
    expect(projected.requirements?.every((requirement) => requirement.satisfied)).toBe(true);
  });

  it("projects earned rewards and completion state only for completed missions", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const activeProjection = projectMission(
      CUT_YOUR_TEETH,
      accepted,
      LOCATION_IDS.theJag,
      true,
      cutYourTeethObservation(),
    );
    expect(activeProjection.earnedReward).toBeUndefined();

    const completedProjection = projectMission(
      CUT_YOUR_TEETH,
      { acceptedAt: now, completedAt: now },
      LOCATION_IDS.theJag,
      true,
      cutYourTeethObservation(),
    );
    expect(completedProjection.earnedReward).toEqual({
      kind: "skill_xp",
      skillId: SKILL_IDS.mining,
      skillName: "Mining",
      amount: 100,
    });
    expect(completedProjection.completedAt).toEqual(now);

    const completedItem = projectMission(
      WALK_IT_OFF,
      { acceptedAt: now, completedAt: now },
      LOCATION_IDS.theJag,
      true,
    );
    expect(completedItem.earnedReward).toEqual({
      kind: "item",
      itemId: ITEM_IDS.salvageCutter,
      itemName: "Salvage Cutter",
    });
  });
});

describe("issue #137 mission terminology guard", () => {
  it("keeps Quest* mission-system names out of the live domain/UI/CSS/tests touched by this work", () => {
    const touched = [
      "game/domain/missions.ts",
      "game/content/missions.ts",
      "server/missions.ts",
      "server/mission-state.ts",
      "features/missions/MissionObjectivePanel.tsx",
      "features/missions/MissionLogPanel.tsx",
      "features/play/PlayScreen.tsx",
      "features/play/PlayConsole.tsx",
      "features/play/PlayContext.tsx",
      "features/play/PlayFooterNav.tsx",
      "features/npc/NpcInteractionPanel.tsx",
      "features/inventory/InventoryPanel.tsx",
      "features/inventory/EquipmentPanel.tsx",
      "features/mining/MiningActivity.tsx",
      "features/refining/RefiningConsole.tsx",
      "components/items/VisualTile.tsx",
      "components/items/ItemVisual.tsx",
      "app/globals.css",
      "docs/missions.md",
      "tests/unit/mission-framework.test.ts",
      "tests/unit/cut-your-teeth.test.ts",
      "tests/unit/missions.test.ts",
      "tests/e2e/walk-it-off.spec.ts",
      "tests/e2e/cut-your-teeth.spec.ts",
      "tests/e2e/overlay.spec.ts",
    ];
    const offenders: string[] = [];
    const missionSystemPattern =
      /QuestGuidanceTargets|deriveQuestGuidanceTargets|quest-guidance|rs-quest|--rs-quest|quest giver|questGuidance/;
    // The guard's own pattern literals would self-match: strip this guard
    // block before scanning so the test proves the touched files, not itself.
    const guardStart = 'describe("issue #137 mission terminology guard"';
    for (const relative of touched) {
      const full = resolve(dirname(fileURLToPath(import.meta.url)), "../../", relative);
      const text = readFileSync(full, "utf8");
      const scannable =
        relative === "tests/unit/mission-framework.test.ts"
          ? text.slice(0, text.indexOf(guardStart))
          : text;
      if (missionSystemPattern.test(scannable)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });
});
