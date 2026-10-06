import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fabricationRecipeForActionId,
  getEffectiveGameBalance,
  getItemDefinition,
  getRepairTargetBalance,
  repairTargetForActionId,
  tinkeringTargetForActionId,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { getDialogue } from "@/game/content/dialogue";
import { getItemPresentation } from "@/game/content/item-presentation";
import { getLocation, isActionAvailableAtLocation } from "@/game/content/locations";
import {
  A_CUT_ABOVE,
  BRACE_YOURSELF,
  MISSIONS,
  WHEEL_BE_RIGHT_BACK,
  type MissionDefinition,
} from "@/game/content/missions";
import { getNpc } from "@/game/content/npcs";
import { getRepairTarget } from "@/game/content/repair-targets";
import { resolveNpcConversation } from "@/game/domain/conversation";
import { fabricationRecipeUnlocked } from "@/game/domain/fabrication";
import { resolveLocationState } from "@/game/domain/location-state";
import {
  deriveMissionGuidanceTargets,
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";
import {
  tinkeringDurationTicks,
  tinkeringScrapYield,
  tinkeringUnlocked,
  tinkeringXp,
} from "@/game/domain/tinkering";

/**
 * Issue #322 — Wheel Be Right Back.
 *
 * Content, routing, and presentation rules provable without PostgreSQL or a
 * browser. The exactly-once reward, the Mission-authorized repair commands, the
 * consumption of traded components, and durable completion are proven against
 * real PostgreSQL in tests/integration/wheel-be-right-back.test.ts; the whole
 * job is played end to end in tests/e2e/wheel-be-right-back.spec.ts.
 */

const balance = getEffectiveGameBalance();
const gear = getRepairTargetBalance(REPAIR_TARGET_IDS.landingGear, balance);
const wheelRecipe = fabricationRecipeForActionId(ACTION_IDS.wheelAssemblyFabrication, balance)!;
const wheelTinkering = tinkeringTargetForActionId(ACTION_IDS.wheelAssemblyTinkering, balance)!;

describe("the Wheel Assembly is an ordinary stack item", () => {
  const definition = getItemDefinition(ITEM_IDS.wheelAssembly, balance);

  it("weighs 1,550 g and stacks two deep", () => {
    expect(definition).toEqual({
      itemId: ITEM_IDS.wheelAssembly,
      kind: "stack",
      massGrams: 1_550,
      stackLimit: 2,
    });
  });

  it("conserves mass through its authored inputs", () => {
    const mass = wheelRecipe.inputs.reduce((sum, input) => {
      const item = getItemDefinition(input.itemId, balance);
      expect(item?.kind, input.itemId).toBe("stack");
      return sum + (item?.massGrams ?? 0) * input.quantity;
    }, 0);
    // 3 x 150 g Refined Ferrite + 800 g Galvanic Stock + 300 g Mounting Bracket.
    expect(mass).toBe(1_550);
    expect(mass).toBe(definition?.massGrams);
  });

  it("lets the whole two-wheel requirement ride in one carried stack", () => {
    const wheels = gear.materials.find((material) => material.itemId === ITEM_IDS.wheelAssembly);
    expect(wheels?.quantity).toBe(2);
    expect(wheels?.quantity).toBe(
      definition && "stackLimit" in definition ? definition.stackLimit : 0,
    );
  });

  it("presents with the approved art, as a full-canvas transparent WebP", () => {
    const presentation = getItemPresentation(ITEM_IDS.wheelAssembly)!;
    expect(presentation.displayName).toBe("Wheel Assembly");
    expect(presentation.artworkSrc).toBe("/item-art/wheel-assembly.webp");
    const file = `public${presentation.artworkSrc}`;
    expect(existsSync(file)).toBe(true);
    const webp = readFileSync(file);
    expect(webp.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(webp.subarray(8, 12).toString("ascii")).toBe("WEBP");
    // The same 640 x 640 lossless canvas as the other Fabrication item art.
    expect(webp.subarray(12, 16).toString("ascii")).toBe("VP8L");
    const bits = webp.readUInt32LE(21);
    expect(((bits >> 0) & 0x3fff) + 1).toBe(640);
    expect(((bits >> 14) & 0x3fff) + 1).toBe(640);
    expect(presentation.accessibleDescription.length).toBeGreaterThan(40);
  });

  it("keeps the approved master out of the served directory", () => {
    expect(existsSync("assets/item-art/wheel-assembly.png")).toBe(true);
  });
});

describe("the Wheel Assembly recipe", () => {
  it("is Fabrication 5 by level alone", () => {
    expect(wheelRecipe.minimumLevel).toBe(5);
    expect(fabricationRecipeUnlocked(4, wheelRecipe)).toBe(false);
    expect(fabricationRecipeUnlocked(5, wheelRecipe)).toBe(true);
  });

  it("consumes 3 Refined Ferrite + 1 Galvanic Stock + 1 Mounting Bracket for 1 Wheel Assembly", () => {
    expect(wheelRecipe.inputs).toEqual([
      { itemId: ITEM_IDS.refinedFerrite, quantity: 3 },
      { itemId: ITEM_IDS.galvanicStock, quantity: 1 },
      { itemId: ITEM_IDS.mountingBracket, quantity: 1 },
    ]);
    expect(wheelRecipe.outputItemId).toBe(ITEM_IDS.wheelAssembly);
    expect(wheelRecipe.outputQuantity).toBe(1);
  });

  it("takes 36 ticks (21.6 seconds) and pays 100 base Fabrication XP", () => {
    expect(wheelRecipe.durationTicks).toBe(36);
    expect((wheelRecipe.durationTicks * 600) / 1_000).toBeCloseTo(21.6);
    expect(wheelRecipe.baseXp).toBe(100);
  });

  it("asks for no Refining level and uses no Galvaferrite", () => {
    expect(wheelRecipe.inputs.map((input) => input.itemId)).not.toContain(ITEM_IDS.galvaferrite);
    expect(Object.keys(wheelRecipe)).not.toContain("requiredRefiningLevel");
  });

  it("is made at the Rusk Recovery station, with its Tinkering beside it", () => {
    expect(isActionAvailableAtLocation(LOCATION_IDS.ruskRecovery, wheelRecipe.actionId)).toBe(true);
    expect(
      isActionAvailableAtLocation(LOCATION_IDS.ruskRecovery, ACTION_IDS.wheelAssemblyTinkering),
    ).toBe(true);
  });
});

describe("the Wheel Assembly in ordinary Tinkering", () => {
  it("dismantles the Fabrication recipe through the universal rules alone", () => {
    expect(wheelTinkering.recipe.actionId).toBe(ACTION_IDS.wheelAssemblyFabrication);
    expect(tinkeringUnlocked(4, wheelTinkering.recipe)).toBe(false);
    expect(tinkeringUnlocked(5, wheelTinkering.recipe)).toBe(true);
    // Base XP, twice the duration, one Scrap per two input units rounded up.
    expect(tinkeringXp(wheelTinkering.recipe)).toBe(100);
    expect(tinkeringDurationTicks(wheelTinkering.recipe, balance)).toBe(72);
    expect(tinkeringScrapYield(wheelTinkering.recipe, balance)).toBe(Math.ceil((3 + 1 + 1) / 2));
  });
});

describe("the Landing Gear repair target", () => {
  it("lives at the Crash Site and is revealed by accepting Wheel Be Right Back", () => {
    expect(getRepairTarget(REPAIR_TARGET_IDS.landingGear)).toMatchObject({
      displayName: "Landing Gear",
      locationId: LOCATION_IDS.crashSite,
      authorization: { kind: "mission", missionId: MISSION_IDS.wheelBeRightBack },
    });
    expect(getRepairTarget(REPAIR_TARGET_IDS.landingGear)?.localPlaceId).toBeUndefined();
  });

  it("consumes exactly 2 Wheel Assemblies + 2 Mounting Brackets + 1 Galvanic Wire Spool", () => {
    expect(gear.materials).toEqual([
      { itemId: ITEM_IDS.wheelAssembly, quantity: 2 },
      { itemId: ITEM_IDS.mountingBracket, quantity: 2 },
      { itemId: ITEM_IDS.galvanicWireSpool, quantity: 1 },
    ]);
  });

  it("is twelve ordinary Welding sections: 600 base XP and the normal Clean Pass", () => {
    expect(gear.repairIncrements).toBe(12);
    expect(gear.repairIncrements * balance.welding.xpPerIncrement).toBe(600);
    // Twelve sections clears the ordinary Clean Pass opportunity threshold.
    expect(gear.repairIncrements).toBeGreaterThanOrEqual(
      balance.welding.cleanPass.minimumSectionsForOpportunity,
    );
    // 12 x 600 ms x 5 ticks of normal global cadence: no Landing-Gear-only timing.
    expect(balance.welding.attemptDurationTicks).toBe(5);
  });

  it("has its own durable Welding action, resolvable back to the target", () => {
    expect(gear.actionId).toBe(ACTION_IDS.landingGearWelding);
    expect(repairTargetForActionId(ACTION_IDS.landingGearWelding, balance)).toBe(
      REPAIR_TARGET_IDS.landingGear,
    );
  });

  it("is a Galvanic-tier job that never touches Galvaferrite", () => {
    expect(gear.materials.map((material) => material.itemId)).not.toContain(ITEM_IDS.galvaferrite);
  });

  it("is worked at the Crash Site and nowhere else", () => {
    expect(isActionAvailableAtLocation(LOCATION_IDS.crashSite, ACTION_IDS.landingGearWelding)).toBe(
      true,
    );
    expect(
      isActionAvailableAtLocation(LOCATION_IDS.ruskRecovery, ACTION_IDS.landingGearWelding),
    ).toBe(false);
  });

  it("annotates its materials and states the finished ship exactly", () => {
    const target = getRepairTarget(REPAIR_TARGET_IDS.landingGear);
    expect(Object.keys(target?.materialNotes ?? {}).sort()).toEqual(
      [ITEM_IDS.wheelAssembly, ITEM_IDS.mountingBracket, ITEM_IDS.galvanicWireSpool].sort(),
    );
    expect(target?.completedStatus).toBe("Landing gear restored. Propulsion offline.");
  });

  it("introduces no new ship art, location variant, flight or route state", () => {
    const crashSite = getLocation(LOCATION_IDS.crashSite)!;
    expect(crashSite.stateVariants).toEqual([]);
    const finished = resolveLocationState(crashSite, {
      acceptedMissionIds: new Set([MISSION_IDS.wheelBeRightBack]),
      completedRepairTargetIds: new Set([REPAIR_TARGET_IDS.landingGear]),
    });
    expect(finished.scene).toBe(crashSite.presentation.scene);
    expect(finished.travelable).toBe(true);
    expect(finished.mapStatus).toBeUndefined();
  });
});

describe("the Mission's shape", () => {
  it("passes authored-content validation", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
  });

  it("carries the locked title and summary", () => {
    expect(WHEEL_BE_RIGHT_BACK.title).toBe("Wheel Be Right Back");
    expect(WHEEL_BE_RIGHT_BACK.summary).toBe(
      "Rebuild the ship's landing gear at the Crash Site, then report to Wade Rusk.",
    );
  });

  it("is gated by Brace Yourself alone: no skill, no A Cut Above", () => {
    expect(WHEEL_BE_RIGHT_BACK.prerequisiteMissionId).toBe(MISSION_IDS.braceYourself);
    expect(WHEEL_BE_RIGHT_BACK.prerequisiteSkillLevels).toBeUndefined();
    expect(WHEEL_BE_RIGHT_BACK.requirements.map((requirement) => requirement.kind)).toEqual([
      "repair_target_complete",
    ]);
    expect(
      MISSIONS.some((mission) => mission.prerequisiteMissionId === MISSION_IDS.aCutAbove),
    ).toBe(false);
    expect(WHEEL_BE_RIGHT_BACK.prerequisiteMissionId).not.toBe(A_CUT_ABOVE.id);
  });

  it("is never an automatic continuation from Brace Yourself or anything else", () => {
    expect(BRACE_YOURSELF.continuationMissionId).toBeUndefined();
    const others: readonly MissionDefinition[] = MISSIONS.filter(
      (mission) => mission.id !== WHEEL_BE_RIGHT_BACK.id,
    );
    expect(others.some((mission) => mission.continuationMissionId === WHEEL_BE_RIGHT_BACK.id)).toBe(
      false,
    );
    // And it starts nothing: Propulsion does not exist yet.
    expect(WHEEL_BE_RIGHT_BACK.continuationMissionId).toBeUndefined();
  });

  it("is offered by hand by Wade at Rusk Recovery with the locked control", () => {
    expect(WHEEL_BE_RIGHT_BACK.offers).toEqual([
      {
        npcId: NPC_IDS.wadeRusk,
        locationId: LOCATION_IDS.ruskRecovery,
        dialogueId: DIALOGUE_IDS.wadeWheelBeRightBackOffer,
        actionLabel: "TAKE THE JOB",
      },
    ]);
  });

  it("asks for the Landing Gear with the locked objective", () => {
    expect(WHEEL_BE_RIGHT_BACK.requirements).toEqual([
      {
        kind: "repair_target_complete",
        targetId: REPAIR_TARGET_IDS.landingGear,
        objective: "Repair the Landing Gear at the Crash Site",
      },
    ]);
  });

  it("turns in to Wade at Rusk Recovery for exactly 250 Welding XP", () => {
    expect(WHEEL_BE_RIGHT_BACK.turnIn).toMatchObject({
      npcId: NPC_IDS.wadeRusk,
      locationId: LOCATION_IDS.ruskRecovery,
      requiresStationary: true,
      actionLabel: "REPORT REPAIR",
    });
    expect(WHEEL_BE_RIGHT_BACK.reward).toEqual({
      kind: "skill_xp",
      skillId: SKILL_IDS.welding,
      amount: 250,
    });
    // 600 from the twelve sections plus 250 from Wade: 850 before Clean Pass.
    expect(gear.repairIncrements * balance.welding.xpPerIncrement + 250).toBe(850);
  });
});

describe("Wade's locked dialogue", () => {
  const texts = (id: string) => getDialogue(id as never)!.beats.map((beat) => beat.text);

  it("makes the locked offer, in order and word for word", () => {
    expect(texts(DIALOGUE_IDS.wadeWheelBeRightBackOffer)).toEqual([
      "Heard the Deep Jag brace is still holding. Good work.",
      "Get the wheels rebuilt and the mounts back under her. Won't make her fly, but there's no point fixing the engine before she can land.",
      "How you get the parts is your business. Two Wheel Assemblies, two Mounting Brackets, one Galvanic Wire Spool.",
    ]);
  });

  it("gives the locked reminder, word for word", () => {
    expect(texts(DIALOGUE_IDS.wadeWheelBeRightBackRepairReminder)).toEqual([
      "Two Wheel Assemblies, two Mounting Brackets, one Galvanic Wire Spool. Get them under the ship at the Crash Site.",
    ]);
  });

  it("completes with the 250 Welding XP tile and the locked lines, word for word", () => {
    const beats = getDialogue(DIALOGUE_IDS.wadeWheelBeRightBackCompletion)!.beats;
    expect(beats.filter((beat) => beat.kind === "skill_xp")).toEqual([
      expect.objectContaining({ skillId: SKILL_IDS.welding, amount: 250 }),
    ]);
    expect(beats.filter((beat) => beat.kind === "npc").map((beat) => beat.text)).toEqual([
      "That'll hold. She's got her feet back under her.",
      "Engine's still dead. That's another job.",
    ]);
  });

  it("writes every beat the Mission can reach, so no state falls back to another job's", () => {
    for (const dialogueId of [
      WHEEL_BE_RIGHT_BACK.offers[0]!.dialogueId,
      WHEEL_BE_RIGHT_BACK.dialogue.repairReminderDialogueId,
      WHEEL_BE_RIGHT_BACK.dialogue.busyDialogueId,
      WHEEL_BE_RIGHT_BACK.turnIn.dialogueId,
      WHEEL_BE_RIGHT_BACK.dialogue.completionPresentationDialogueId,
      WHEEL_BE_RIGHT_BACK.completedNpcDialogue?.[0]?.dialogueId,
    ]) {
      expect(dialogueId, "an authored dialogue slot is missing").toBeDefined();
      expect(getDialogue(dialogueId!)?.npcId).toBe(NPC_IDS.wadeRusk);
    }
  });

  it("speaks only with Wade's three approved expressions, at his yard, with no exclamation", () => {
    const art = Object.keys(getNpc(NPC_IDS.wadeRusk)?.expressionAssets ?? {});
    const sequences = [
      DIALOGUE_IDS.wadeWheelBeRightBackOffer,
      DIALOGUE_IDS.wadeWheelBeRightBackRepairReminder,
      DIALOGUE_IDS.wadeWheelBeRightBackBusy,
      DIALOGUE_IDS.wadeWheelBeRightBackTurnIn,
      DIALOGUE_IDS.wadeWheelBeRightBackCompletion,
      DIALOGUE_IDS.wadePostWheelBeRightBack,
    ];
    for (const id of sequences) {
      for (const beat of getDialogue(id)!.beats) {
        expect(beat.backgroundId, id).toBe(CONVERSATION_BACKGROUND_IDS.ruskRecoveryYard);
        if (beat.kind !== "npc") continue;
        expect(beat.speakerNpcId).toBe(NPC_IDS.wadeRusk);
        expect(beat.presentationMode).toBe("local");
        expect(art, id).toContain(beat.expressionId);
        expect(beat.text, id).not.toContain("!");
      }
    }
  });

  it("chooses an expression for every beat rather than defaulting them all", () => {
    const used = new Set(
      [
        DIALOGUE_IDS.wadeWheelBeRightBackOffer,
        DIALOGUE_IDS.wadeWheelBeRightBackCompletion,
        DIALOGUE_IDS.wadePostWheelBeRightBack,
      ].flatMap((id) =>
        getDialogue(id)!.beats.flatMap((beat) => (beat.kind === "npc" ? [beat.expressionId] : [])),
      ),
    );
    expect(used).toContain(EXPRESSION_IDS.neutral);
    expect(used).toContain(EXPRESSION_IDS.scowl);
    expect(used).toContain(EXPRESSION_IDS.concerned);
  });

  it("lets Wade's follow-up present wherever he is standing", () => {
    expect(getDialogue(DIALOGUE_IDS.wadePostWheelBeRightBack)?.presentsAtCurrentVenue).toBe(true);
  });
});

function observation(
  options: { carried?: Record<string, number>; installed?: boolean; welded?: number } = {},
): MissionObservation {
  const installed = options.installed ?? false;
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map(Object.entries(options.carried ?? {})),
    stackLimits: new Map(),
    itemNames: new Map([
      [ITEM_IDS.wheelAssembly, "Wheel Assembly"],
      [ITEM_IDS.mountingBracket, "Mounting Bracket"],
      [ITEM_IDS.galvanicWireSpool, "Galvanic Wire Spool"],
    ]),
    // Deliberately the lowest possible levels: no skill may matter here.
    skillLevels: new Map([
      [SKILL_IDS.welding, 1],
      [SKILL_IDS.fabrication, 1],
      [SKILL_IDS.refining, 1],
    ]),
    repairTargets: new Map([
      [
        REPAIR_TARGET_IDS.landingGear,
        {
          complete: installed,
          materials: gear.materials.map((material) => ({
            itemId: material.itemId,
            contributed: installed || (options.welded ?? 0) > 0 ? material.quantity : 0,
            required: material.quantity,
          })),
          welding: {
            completed: installed ? gear.repairIncrements : (options.welded ?? 0),
            required: gear.repairIncrements,
          },
        },
      ],
    ]),
  };
}

const accepted = { acceptedAt: new Date("2026-10-05T00:00:00.000Z") };
const completed = { ...accepted, completedAt: new Date("2026-10-05T01:00:00.000Z") };

function project(
  mission: { acceptedAt?: Date; completedAt?: Date } | undefined,
  options: Parameters<typeof observation>[0] & { prerequisiteCompleted?: boolean } = {},
  at: string = LOCATION_IDS.ruskRecovery,
): MissionProjection {
  return projectMission(
    WHEEL_BE_RIGHT_BACK,
    mission,
    at,
    true,
    observation(options),
    options.prerequisiteCompleted ?? true,
  );
}

function wadeEntries(projection: MissionProjection) {
  return resolveNpcConversation(NPC_IDS.wadeRusk, [
    {
      missionId: projection.missionId,
      state: projection.state,
      prerequisiteSatisfied: projection.prerequisiteSatisfied,
      stage: projection.stage,
      requirements: projection.requirements,
    },
  ]);
}

describe("conversation routing through every stage", () => {
  it("is not offered before Brace Yourself is complete", () => {
    const locked = project(undefined, { prerequisiteCompleted: false });
    expect(locked.prerequisiteSatisfied).toBe(false);
    expect(
      wadeEntries(locked).some(
        (entry) => entry.dialogueId === DIALOGUE_IDS.wadeWheelBeRightBackOffer,
      ),
    ).toBe(false);
  });

  it("is offered manually once it is, at the lowest possible skill levels", () => {
    const available = project(undefined);
    expect(available.state).toBe("not_accepted");
    expect(available.guidance?.availableNpcIds).toEqual([NPC_IDS.wadeRusk]);
    expect(wadeEntries(available)[0]).toMatchObject({
      kind: "mission",
      role: "offer",
      dialogueId: DIALOGUE_IDS.wadeWheelBeRightBackOffer,
      action: { kind: "accept_mission", label: "TAKE THE JOB" },
    });
  });

  it("reminds without a command however far the work has got", () => {
    for (const welded of [0, 4, 11]) {
      const active = project(accepted, { welded });
      expect(active.state).toBe("active");
      const [reminder] = wadeEntries(active);
      expect(reminder).toMatchObject({
        role: "active",
        dialogueId: DIALOGUE_IDS.wadeWheelBeRightBackRepairReminder,
      });
      expect(reminder && "action" in reminder ? reminder.action : undefined).toBeUndefined();
    }
  });

  it("guides the Landing Gear, wherever the player carries parts for it, and not before", () => {
    // Nothing useful carried: the framework invents no source for the parts.
    expect([...deriveMissionGuidanceTargets([project(accepted)]).repairTargetIds]).toEqual([]);
    // Wheels bought or traded from another player count exactly like fabricated ones.
    const carrying = project(accepted, { carried: { [ITEM_IDS.wheelAssembly]: 2 } });
    expect([...deriveMissionGuidanceTargets([carrying]).repairTargetIds]).toEqual([
      REPAIR_TARGET_IDS.landingGear,
    ]);
    expect(carrying.guidance).toMatchObject({
      repairTargetId: REPAIR_TARGET_IDS.landingGear,
      locationId: LOCATION_IDS.crashSite,
    });
  });

  it("turns to Wade the moment the Landing Gear is complete", () => {
    const installed = project(accepted, { installed: true });
    expect(installed.state).toBe("ready_for_completion");
    expect(wadeEntries(installed)[0]).toMatchObject({
      role: "turn_in",
      dialogueId: DIALOGUE_IDS.wadeWheelBeRightBackTurnIn,
      action: { kind: "complete_mission", label: "REPORT REPAIR" },
    });
    const targets = deriveMissionGuidanceTargets([installed]);
    expect([...targets.repairTargetIds]).toEqual([]);
    expect([...targets.turnInNpcIds]).toEqual([NPC_IDS.wadeRusk]);
  });

  it("settles into Wade's follow-up with no command left", () => {
    const done = wadeEntries(project(completed, { installed: true }));
    expect(done[0]).toMatchObject({
      role: "completed",
      dialogueId: DIALOGUE_IDS.wadePostWheelBeRightBack,
    });
    expect(done.some((entry) => "action" in entry && entry.action)).toBe(false);
  });
});
