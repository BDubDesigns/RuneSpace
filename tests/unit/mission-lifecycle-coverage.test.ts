import { describe, expect, it } from "vitest";
import {
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { CONVERSATION_TOPICS } from "@/game/content/conversation-topics";
import {
  HOLD_IT_TOGETHER,
  MISSIONS,
  type MissionDefinition,
  type MissionDialogue,
} from "@/game/content/missions";
import {
  resolveNpcConversationWith,
  type NpcConversationProjection,
} from "@/game/domain/conversation";
import { missionLifecycleMoments, validateMissionDefinitions } from "@/game/domain/missions";
import type { ContentId } from "@/game/schemas/ids";

/**
 * Issue #324: every lifecycle moment a Mission can reach at its turn-in NPC is
 * either authored or deliberately declared omitted — never an accidental
 * fallback to dialogue written for a different moment.
 */

/** A synthetic repair Mission built on Hold It Together's real content. */
function repairMission(
  dialogue: Partial<MissionDialogue>,
  overrides: Partial<MissionDefinition> = {},
): MissionDefinition {
  return {
    ...HOLD_IT_TOGETHER,
    id: "synthetic_repair" as ContentId,
    offers: [
      {
        npcId: NPC_IDS.wadeRusk,
        locationId: LOCATION_IDS.crashSite,
        dialogueId: DIALOGUE_IDS.wadeKeepTheChangeOffer,
      },
    ],
    continuationMissionId: undefined,
    prerequisiteMissionId: undefined,
    ...overrides,
    dialogue: { ...HOLD_IT_TOGETHER.dialogue, ...dialogue },
  } as MissionDefinition;
}

const validate = (definition: MissionDefinition) => () => validateMissionDefinitions([definition]);

function turnInEntry(
  definition: MissionDefinition,
  stage: NonNullable<NpcConversationProjection["stage"]>,
) {
  return resolveNpcConversationWith(
    definition.turnIn.npcId,
    [{ missionId: definition.id, state: "active", prerequisiteSatisfied: true, stage }],
    [definition],
    CONVERSATION_TOPICS,
  ).find((entry) => entry.kind === "mission" && entry.missionId === definition.id);
}

const REPAIR_UNMET = {
  requirementsSatisfied: false,
  turnInAvailable: false,
  nextObjectiveKind: "repair_target_complete",
} as const;
const BUSY = { requirementsSatisfied: true, turnInAvailable: false } as const;

describe("issue #324 reachable lifecycle moments", () => {
  it("derives reminders from requirement kinds, plus busy and completion for every Mission", () => {
    expect(missionLifecycleMoments(HOLD_IT_TOGETHER)).toEqual([
      "repair_reminder",
      "busy",
      "completion_presentation",
    ]);
    expect(
      missionLifecycleMoments({
        requirements: [
          { kind: "at_location", locationId: LOCATION_IDS.theJag, objective: "Go" },
          {
            kind: "carried_unique_item",
            itemId: ITEM_IDS.salvageCutter,
            turnIn: "show",
            objective: "Show",
          },
        ],
      }),
    ).toEqual(["carried_reminder", "busy", "completion_presentation"]);
  });

  it("keeps every production omission explicit and reviewable", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
    const omissions = MISSIONS.flatMap((mission) =>
      (mission.dialogue.omitted ?? []).map((omission) => `${mission.id}:${omission.moment}`),
    );
    // A new entry here is a product decision a reviewer should see, not churn.
    expect(omissions).toEqual(["walk_it_off:busy", "curly_must_stash:busy"]);
  });
});

describe("issue #324 lifecycle coverage validation", () => {
  it("rejects a reachable reminder that is neither authored nor declared omitted", () => {
    expect(validate(repairMission({ repairReminderDialogueId: undefined }))).toThrow(
      /"repair_reminder" moment but neither authors "repairReminderDialogueId"/,
    );
    expect(validate(repairMission({ busyDialogueId: undefined }))).toThrow(/"busy" moment/);
    expect(validate(repairMission({ completionPresentationDialogueId: undefined }))).toThrow(
      /"completion_presentation" moment/,
    );
  });

  it("accepts an omission declared with a reason", () => {
    expect(
      validate(
        repairMission({
          repairReminderDialogueId: undefined,
          omitted: [{ moment: "repair_reminder", reason: "The turn-in opening already says it." }],
        }),
      ),
    ).not.toThrow();
  });

  it("rejects an omission without a reason, twice, or alongside an authored sequence", () => {
    expect(
      validate(
        repairMission({ busyDialogueId: undefined, omitted: [{ moment: "busy", reason: " " }] }),
      ),
    ).toThrow(/reason/);
    expect(
      validate(
        repairMission({
          busyDialogueId: undefined,
          omitted: [
            { moment: "busy", reason: "One." },
            { moment: "busy", reason: "Two." },
          ],
        }),
      ),
    ).toThrow(/twice/);
    expect(validate(repairMission({ omitted: [{ moment: "busy", reason: "Both." }] }))).toThrow(
      /both authors and omits/,
    );
  });

  it("rejects a slot or declaration for a moment no requirement can reach", () => {
    expect(
      validate(
        repairMission({ equipmentReminderDialogueId: DIALOGUE_IDS.tansyCutYourTeethEquipReminder }),
      ),
    ).toThrow(/"equipment_reminder" moment, which none of its requirements can reach/);
    expect(
      validate(repairMission({ omitted: [{ moment: "carried_reminder", reason: "Unused." }] })),
    ).toThrow(/"carried_reminder" moment, which none/);
  });

  it("rejects a turn-in-NPC sequence spoken by somebody else", () => {
    expect(
      validate(
        repairMission({ repairReminderDialogueId: DIALOGUE_IDS.rennOutOfTheWeatherRepairReminder }),
      ),
    ).toThrow(/belongs to NPC "renn_calder"/);
  });

  it("rejects an at_location requirement away from the turn-in, which has no reminder", () => {
    expect(
      validate(
        repairMission(
          {},
          {
            requirements: [
              ...HOLD_IT_TOGETHER.requirements,
              { kind: "at_location", locationId: LOCATION_IDS.theJag, objective: "Go" },
            ],
          },
        ),
      ),
    ).toThrow(/differs from its turn-in location/);
  });

  it("requires the completion presentation to present every authored reward grant", () => {
    expect(
      validate(
        repairMission(
          {},
          { reward: { kind: "skill_xp", skillId: SKILL_IDS.welding, amount: 999 } },
        ),
      ),
    ).toThrow(/does not present its 999 welding XP reward/);
    // Credits are presented by the runtime receipt tile, never an authored beat.
    expect(validate(repairMission({}, { reward: { kind: "credits", amount: 5 } }))).not.toThrow();
  });
});

describe("issue #324 resolver never silently substitutes the turn-in", () => {
  const turnInId = HOLD_IT_TOGETHER.turnIn.dialogueId;

  it("presents the authored reminder and busy sequences without a turn-in command", () => {
    const definition = repairMission({});
    expect(turnInEntry(definition, REPAIR_UNMET)).toMatchObject({
      role: "active",
      dialogueId: HOLD_IT_TOGETHER.dialogue.repairReminderDialogueId,
    });
    expect(turnInEntry(definition, REPAIR_UNMET)).not.toHaveProperty("action");
    expect(turnInEntry(definition, BUSY)).toMatchObject({
      role: "active",
      dialogueId: HOLD_IT_TOGETHER.dialogue.busyDialogueId,
    });
  });

  it("offers no entry for an undeclared gap rather than the turn-in opening", () => {
    const definition = repairMission({
      repairReminderDialogueId: undefined,
      busyDialogueId: undefined,
    });
    expect(turnInEntry(definition, REPAIR_UNMET)).toBeUndefined();
    expect(turnInEntry(definition, BUSY)).toBeUndefined();
  });

  it("falls back to the turn-in opening only where the omission is declared", () => {
    const definition = repairMission({
      repairReminderDialogueId: undefined,
      busyDialogueId: undefined,
      omitted: [{ moment: "busy", reason: "Declared for this test." }],
    });
    expect(turnInEntry(definition, BUSY)).toMatchObject({
      role: "turn_in",
      dialogueId: turnInId,
      action: { kind: "complete_mission" },
    });
    expect(turnInEntry(definition, REPAIR_UNMET)).toBeUndefined();
  });

  it("routes identically whatever the Mission ID is", () => {
    const declared = { omitted: [{ moment: "busy" as const, reason: "ID-agnostic." }] };
    const a = repairMission({ busyDialogueId: undefined, ...declared });
    const b = { ...a, id: "another_synthetic_repair" as ContentId };
    for (const stage of [REPAIR_UNMET, BUSY]) {
      const left = turnInEntry(a, stage);
      const right = turnInEntry(b, stage);
      expect(right?.dialogueId).toBe(left?.dialogueId);
      expect(right?.kind === "mission" && right.role).toBe(left?.kind === "mission" && left.role);
    }
  });
});
