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
  deriveQuestGuidanceTargets,
  projectMission,
  validateMissionDefinitions,
} from "@/game/domain/missions";
import { AcceptMissionRequestSchema, CompleteMissionRequestSchema } from "@/game/schemas/gameplay";

function definitionOf(overrides: Partial<MissionDefinition>): MissionDefinition {
  return { ...WALK_IT_OFF, ...overrides } as MissionDefinition;
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

describe("quest-available vs quest-active guidance (preview correction)", () => {
  it("projects every authored offer location for a brand-new character without requiring availableObjective", () => {
    const atCrashSite = projectMission(WALK_IT_OFF, undefined, LOCATION_IDS.crashSite, true);
    const atTheJag = projectMission(WALK_IT_OFF, undefined, LOCATION_IDS.theJag, true);
    expect(atCrashSite.guidance?.availableNpcIds).toEqual([NPC_IDS.wadeRusk]);
    expect(atTheJag.guidance?.availableNpcIds).toEqual([NPC_IDS.tansyRusk]);
    expect(atCrashSite.guidance?.npcId).toBeUndefined();
    expect(atTheJag.guidance?.npcId).toBeUndefined();
    expect(WALK_IT_OFF.availableObjective).toBeUndefined();
    expect(atCrashSite.availableObjective).toBeUndefined();
  });

  it("does not advertise a prerequisite-gated mission until the prerequisite is satisfied", () => {
    const locked = projectMission(
      CUT_YOUR_TEETH,
      undefined,
      LOCATION_IDS.theJag,
      true,
      undefined,
      false,
    );
    expect(locked.guidance?.availableNpcIds).toBeUndefined();
    const available = projectMission(
      CUT_YOUR_TEETH,
      undefined,
      LOCATION_IDS.theJag,
      true,
      undefined,
      true,
    );
    expect(available.guidance?.availableNpcIds).toEqual([NPC_IDS.tansyRusk]);
  });

  it("removes available guidance once the mission is accepted and shows active progression", () => {
    const accepted = { acceptedAt: new Date("2026-01-01T00:00:00.000Z") };
    const activeAtCrashSite = projectMission(WALK_IT_OFF, accepted, LOCATION_IDS.crashSite, true);
    expect(activeAtCrashSite.guidance?.availableNpcIds).toBeUndefined();
    const activeAtTheJag = projectMission(WALK_IT_OFF, accepted, LOCATION_IDS.theJag, true);
    const targets = deriveQuestGuidanceTargets([activeAtTheJag]);
    expect([...targets.npcIds]).toEqual([NPC_IDS.tansyRusk]);
    expect([...targets.availableNpcIds]).toEqual([]);
  });

  it("keeps available and active guidance semantically distinct with active winning on overlap", () => {
    const overlap = deriveQuestGuidanceTargets([
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
