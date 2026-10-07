import { existsSync } from "node:fs";
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
import {
  getConversationBackground,
  resolveConversationBackgroundId,
} from "@/game/content/conversation-backgrounds";
import { getDialogue } from "@/game/content/dialogue";
import { getItemPresentation } from "@/game/content/item-presentation";
import { getLocation, isActionAvailableAtLocation } from "@/game/content/locations";
import {
  MISSIONS,
  THRUST_ISSUES,
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
  missionSkillPrerequisiteSatisfied,
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";
import { completedRepairStatus, validateRepairTargets } from "@/game/domain/repair-targets";
import {
  tinkeringDurationTicks,
  tinkeringScrapYield,
  tinkeringUnlocked,
  tinkeringXp,
} from "@/game/domain/tinkering";
import { readImageHeader } from "./image-header";

/**
 * Issue #330 — Thrust Issues.
 *
 * Content, routing, scene and presentation rules provable without PostgreSQL or
 * a browser. The Welding-8 refusal of forged acceptance and repair commands, the
 * consumption of traded components, exactly-once completion and character-scoped
 * state are proven against real PostgreSQL in tests/integration/thrust-issues.test.ts;
 * the whole job is played end to end in tests/e2e/thrust-issues.spec.ts.
 */

const balance = getEffectiveGameBalance();
const propulsion = getRepairTargetBalance(REPAIR_TARGET_IDS.propulsionSystem, balance);
const mountRecipe = fabricationRecipeForActionId(ACTION_IDS.driveMountFabrication, balance)!;
const mountTinkering = tinkeringTargetForActionId(ACTION_IDS.driveMountTinkering, balance)!;

describe("the Drive Mount is an ordinary stack item", () => {
  const definition = getItemDefinition(ITEM_IDS.driveMount, balance);

  it("weighs 2,900 g and stacks two deep", () => {
    expect(definition).toEqual({
      itemId: ITEM_IDS.driveMount,
      kind: "stack",
      massGrams: 2_900,
      stackLimit: 2,
    });
  });

  it("conserves mass through its authored inputs", () => {
    const mass = mountRecipe.inputs.reduce((sum, input) => {
      const item = getItemDefinition(input.itemId, balance);
      expect(item?.kind, input.itemId).toBe("stack");
      return sum + (item?.massGrams ?? 0) * input.quantity;
    }, 0);
    // 2 x 950 g Galvaferrite + a 1,000 g Galvanic Wire Spool.
    expect(mass).toBe(2_900);
    expect(mass).toBe(definition?.massGrams);
  });

  it("lets the whole two-mount requirement ride in one carried stack", () => {
    const mounts = propulsion.materials.find((material) => material.itemId === ITEM_IDS.driveMount);
    expect(mounts?.quantity).toBe(2);
    expect(mounts?.quantity).toBe(
      definition && "stackLimit" in definition ? definition.stackLimit : 0,
    );
  });

  it("presents with the approved art as a 640 x 640 lossless transparent WebP", () => {
    const presentation = getItemPresentation(ITEM_IDS.driveMount)!;
    expect(presentation.displayName).toBe("Drive Mount");
    expect(presentation.pluralName).toBe("Drive Mounts");
    expect(presentation.description).toBe(
      "A reinforced powered mount that secures the ship's drive to its frame.",
    );
    expect(presentation.artworkSrc).toBe("/item-art/drive-mount.webp");
    const file = `public${presentation.artworkSrc}`;
    expect(existsSync(file)).toBe(true);
    // The same canvas as the other Fabrication item art.
    expect(readImageHeader(file)).toEqual({ width: 640, height: 640, container: "VP8L" });
    expect(presentation.accessibleDescription.length).toBeGreaterThan(40);
  });

  it("keeps the approved master out of the served directory", () => {
    expect(existsSync("assets/item-art/drive-mount.png")).toBe(true);
  });

  it("leaves no second Coupler item or alias behind", () => {
    expect(Object.keys(ITEM_IDS)).not.toContain("driveCoupler");
    expect(Object.values(ITEM_IDS)).not.toContain("drive_coupler");
  });
});

describe("the Drive Mount recipe", () => {
  it("is Fabrication 8 by level alone", () => {
    expect(mountRecipe.minimumLevel).toBe(8);
    expect(fabricationRecipeUnlocked(7, mountRecipe)).toBe(false);
    expect(fabricationRecipeUnlocked(8, mountRecipe)).toBe(true);
  });

  it("consumes 2 Galvaferrite + 1 Galvanic Wire Spool for 1 Drive Mount", () => {
    expect(mountRecipe.inputs).toEqual([
      { itemId: ITEM_IDS.galvaferrite, quantity: 2 },
      { itemId: ITEM_IDS.galvanicWireSpool, quantity: 1 },
    ]);
    expect(mountRecipe.outputItemId).toBe(ITEM_IDS.driveMount);
    expect(mountRecipe.outputQuantity).toBe(1);
  });

  it("takes 48 ticks (28.8 seconds) and pays 200 base Fabrication XP", () => {
    expect(mountRecipe.durationTicks).toBe(48);
    expect((mountRecipe.durationTicks * 600) / 1_000).toBeCloseTo(28.8);
    expect(mountRecipe.baseXp).toBe(200);
  });

  it("asks for no Refining level", () => {
    expect(Object.keys(mountRecipe)).not.toContain("requiredRefiningLevel");
  });

  it("is made at the Rusk Recovery station, with its Tinkering beside it", () => {
    expect(isActionAvailableAtLocation(LOCATION_IDS.ruskRecovery, mountRecipe.actionId)).toBe(true);
    expect(
      isActionAvailableAtLocation(LOCATION_IDS.ruskRecovery, ACTION_IDS.driveMountTinkering),
    ).toBe(true);
  });

  it("unlocks through Fabrication alone: accepting Thrust Issues is not a recipe gate", () => {
    expect(THRUST_ISSUES.offers.some((offer) => "acceptEffect" in offer)).toBe(false);
    expect(Object.keys(mountRecipe).sort()).toEqual(
      [
        "actionId",
        "baseXp",
        "durationTicks",
        "inputs",
        "minimumLevel",
        "outputItemId",
        "outputQuantity",
      ].sort(),
    );
  });
});

describe("the Drive Mount in ordinary Tinkering", () => {
  it("dismantles the Fabrication recipe through the universal rules alone", () => {
    expect(mountTinkering.recipe.actionId).toBe(ACTION_IDS.driveMountFabrication);
    expect(tinkeringUnlocked(7, mountTinkering.recipe)).toBe(false);
    expect(tinkeringUnlocked(8, mountTinkering.recipe)).toBe(true);
    // Base XP, twice the duration, one Scrap per two input units rounded up.
    expect(tinkeringXp(mountTinkering.recipe)).toBe(200);
    expect(tinkeringDurationTicks(mountTinkering.recipe, balance)).toBe(96);
    expect(tinkeringScrapYield(mountTinkering.recipe, balance)).toBe(Math.ceil((2 + 1) / 2));
  });
});

describe("the Propulsion System repair target", () => {
  it("lives at the Crash Site, revealed by Thrust Issues and gated on personal Welding 8", () => {
    expect(getRepairTarget(REPAIR_TARGET_IDS.propulsionSystem)).toMatchObject({
      displayName: "Propulsion System",
      locationId: LOCATION_IDS.crashSite,
      authorization: {
        kind: "mission",
        missionId: MISSION_IDS.thrustIssues,
        minimumWeldingLevel: 8,
      },
    });
    expect(getRepairTarget(REPAIR_TARGET_IDS.propulsionSystem)?.localPlaceId).toBeUndefined();
  });

  it("asks the repair for the same Welding level the Mission asks of the offer", () => {
    // One literal in two places would be able to drift into a Mission a player
    // can accept and then never work; this is the guard against that.
    const authorization = getRepairTarget(REPAIR_TARGET_IDS.propulsionSystem)!.authorization;
    expect(authorization.kind).toBe("mission");
    expect(THRUST_ISSUES.prerequisiteSkillLevels).toEqual([
      {
        skillId: SKILL_IDS.welding,
        level: authorization.kind === "mission" ? authorization.minimumWeldingLevel : -1,
      },
    ]);
  });

  it("consumes exactly 2 Drive Mounts + 1 Galvaferrite + 2 Mounting Brackets + 1 Wire Spool", () => {
    expect(propulsion.materials).toEqual([
      { itemId: ITEM_IDS.driveMount, quantity: 2 },
      { itemId: ITEM_IDS.galvaferrite, quantity: 1 },
      { itemId: ITEM_IDS.mountingBracket, quantity: 2 },
      { itemId: ITEM_IDS.galvanicWireSpool, quantity: 1 },
    ]);
  });

  it("embeds 5 Galvaferrite, 3 Wire Spools and 2 Brackets in a self-produced project", () => {
    // The installation consumes the finished Mounts; this is only what making
    // them yourself represents, and nothing consumes the expanded total.
    const totals = new Map<string, number>();
    for (const material of propulsion.materials) {
      const recipe = material.itemId === ITEM_IDS.driveMount ? mountRecipe : undefined;
      for (const input of recipe?.inputs ?? [{ itemId: material.itemId, quantity: 1 }]) {
        const count = recipe ? input.quantity * material.quantity : material.quantity;
        totals.set(input.itemId, (totals.get(input.itemId) ?? 0) + count);
      }
    }
    expect(totals.get(ITEM_IDS.galvaferrite)).toBe(5);
    expect(totals.get(ITEM_IDS.galvanicWireSpool)).toBe(3);
    expect(totals.get(ITEM_IDS.mountingBracket)).toBe(2);
  });

  it("is sixteen ordinary Welding sections: 800 base XP and the normal Clean Pass", () => {
    expect(propulsion.repairIncrements).toBe(16);
    expect(propulsion.repairIncrements * balance.welding.xpPerIncrement).toBe(800);
    expect(propulsion.repairIncrements).toBeGreaterThanOrEqual(
      balance.welding.cleanPass.minimumSectionsForOpportunity,
    );
    // No Propulsion-only timing: the global cadence is the only one.
    expect(balance.welding.attemptDurationTicks).toBe(5);
    expect(Object.keys(propulsion).sort()).toEqual(
      ["actionId", "materials", "repairIncrements", "targetId"].sort(),
    );
  });

  it("has its own durable Welding action, resolvable back to the target", () => {
    expect(propulsion.actionId).toBe(ACTION_IDS.propulsionWelding);
    expect(repairTargetForActionId(ACTION_IDS.propulsionWelding, balance)).toBe(
      REPAIR_TARGET_IDS.propulsionSystem,
    );
  });

  it("is worked at the Crash Site and nowhere else", () => {
    expect(isActionAvailableAtLocation(LOCATION_IDS.crashSite, ACTION_IDS.propulsionWelding)).toBe(
      true,
    );
    expect(
      isActionAvailableAtLocation(LOCATION_IDS.ruskRecovery, ACTION_IDS.propulsionWelding),
    ).toBe(false);
  });

  it("passes startup validation and rejects a nonsensical Welding level", () => {
    const missionIds = new Set(MISSIONS.map((mission) => mission.id));
    const target = getRepairTarget(REPAIR_TARGET_IDS.propulsionSystem)!;
    expect(() => validateRepairTargets([target], missionIds)).not.toThrow();
    for (const minimumWeldingLevel of [0, -1, 2.5]) {
      expect(() =>
        validateRepairTargets(
          [
            {
              ...target,
              authorization: {
                kind: "mission",
                missionId: MISSION_IDS.thrustIssues,
                minimumWeldingLevel,
              },
            },
          ],
          missionIds,
        ),
      ).toThrow(/invalid Welding level gate/);
    }
  });

  it("annotates exactly the materials its recipe requires", () => {
    const target = getRepairTarget(REPAIR_TARGET_IDS.propulsionSystem);
    expect(Object.keys(target?.materialNotes ?? {}).sort()).toEqual(
      [
        ITEM_IDS.driveMount,
        ITEM_IDS.galvaferrite,
        ITEM_IDS.mountingBracket,
        ITEM_IDS.galvanicWireSpool,
      ].sort(),
    );
  });
});

describe("the ship's status words come from the repairs and the Mission, nothing else", () => {
  const propulsionTarget = getRepairTarget(REPAIR_TARGET_IDS.propulsionSystem)!;
  const gearTarget = getRepairTarget(REPAIR_TARGET_IDS.landingGear)!;

  it("states the locked statuses before turn-in and after it", () => {
    expect(propulsionTarget.completedStatus).toBe("Propulsion restored. Report to Wade.");
    expect(propulsionTarget.reportedStatus).toBe("Propulsion restored. Ship flight-ready.");
    expect(completedRepairStatus(propulsionTarget, [])).toBe(
      "Propulsion restored. Report to Wade.",
    );
    for (const state of ["not_accepted", "active", "ready_for_completion"]) {
      expect(
        completedRepairStatus(propulsionTarget, [{ missionId: MISSION_IDS.thrustIssues, state }]),
      ).toBe("Propulsion restored. Report to Wade.");
    }
    expect(
      completedRepairStatus(propulsionTarget, [
        { missionId: MISSION_IDS.thrustIssues, state: "completed" },
      ]),
    ).toBe("Propulsion restored. Ship flight-ready.");
  });

  it("does not take another Mission's completion for the turn-in", () => {
    expect(
      completedRepairStatus(propulsionTarget, [
        { missionId: MISSION_IDS.wheelBeRightBack, state: "completed" },
      ]),
    ).toBe("Propulsion restored. Report to Wade.");
  });

  it("no longer claims Propulsion offline anywhere on the Landing Gear", () => {
    expect(gearTarget.completedStatus).toBe("Landing gear restored.");
    expect(gearTarget.completedStatus).not.toMatch(/propulsion/i);
    expect(gearTarget.reportedStatus).toBeUndefined();
    // Landing Gear restoration changes with no Mission and no Propulsion fact.
    expect(
      completedRepairStatus(gearTarget, [
        { missionId: MISSION_IDS.wheelBeRightBack, state: "completed" },
      ]),
    ).toBe("Landing gear restored.");
  });

  it("shows a compact offline status with no recipe or progression hint", () => {
    const offline = propulsionTarget.offlineStatus ?? "";
    expect(offline).toBe("The propulsion system is damaged and cannot be repaired yet.");
    expect(offline).not.toMatch(/Welding|Drive Mount|Galvaferrite|Wade|Fabrication|level/i);
  });
});

describe("the Crash Site scene follows the Propulsion repair, per character", () => {
  const crashSite = getLocation(LOCATION_IDS.crashSite)!;
  const facts = (completed: string[], accepted: string[] = []) => ({
    acceptedMissionIds: new Set(accepted),
    completedRepairTargetIds: new Set(completed),
  });

  it("is the approved crashed Rivet until Propulsion completes, whatever else is done", () => {
    const base = crashSite.presentation.scene;
    expect(base.asset).toBe("/location-scenes/crash-site-crashed.webp");
    for (const completed of [
      [],
      [REPAIR_TARGET_IDS.cargoHold],
      [REPAIR_TARGET_IDS.landingGear],
      [REPAIR_TARGET_IDS.cargoHold, REPAIR_TARGET_IDS.landingGear],
    ]) {
      expect(resolveLocationState(crashSite, facts(completed)).scene).toBe(base);
    }
    // Accepting the Mission, even with every other repair done, repairs nothing.
    expect(
      resolveLocationState(
        crashSite,
        facts([REPAIR_TARGET_IDS.landingGear], [MISSION_IDS.thrustIssues]),
      ).scene,
    ).toBe(base);
  });

  it("becomes the approved repaired Rivet the moment Propulsion completes", () => {
    const resolved = resolveLocationState(crashSite, facts([REPAIR_TARGET_IDS.propulsionSystem]));
    expect(resolved.variantId).toBe("crash_site_ship_restored");
    expect(resolved.scene.asset).toBe("/location-scenes/crash-site-repaired.webp");
    expect(resolved.description).toMatch(/repaired/);
    // Presentation only: the same actions, and no travel or map state of its own.
    expect(resolved.availableActionIds).toEqual(crashSite.availableActionIds);
    expect(resolved.travelable).toBe(crashSite.travelable);
    expect(resolved.mapStatus).toBe(crashSite.mapStatus);
  });

  it("derives from each character's own facts, so one character's repair is not another's", () => {
    const a = resolveLocationState(crashSite, facts([REPAIR_TARGET_IDS.propulsionSystem]));
    const b = resolveLocationState(crashSite, facts([]));
    expect(a.scene.asset).toBe("/location-scenes/crash-site-repaired.webp");
    expect(b.scene.asset).toBe("/location-scenes/crash-site-crashed.webp");
  });

  it("ships exactly the two approved scenes at their delivered 1536 x 384", () => {
    for (const [asset, scene] of [
      ["public/location-scenes/crash-site-crashed.webp", crashSite.presentation.scene],
      ["public/location-scenes/crash-site-repaired.webp", crashSite.stateVariants[0]!.scene!],
    ] as const) {
      expect(existsSync(asset)).toBe(true);
      expect(readImageHeader(asset)).toMatchObject({ width: 1536, height: 384 });
      expect(scene).toMatchObject({ width: 1536, height: 384 });
      expect(`public${scene.asset}`).toBe(asset);
    }
    expect(crashSite.stateVariants).toHaveLength(1);
    // The legacy wreck is replaced, and the approved masters are retained.
    expect(existsSync("public/location-scenes/crash-site.webp")).toBe(false);
    expect(existsSync("assets/location-scenes/crash-site-crashed.png")).toBe(true);
    expect(existsSync("assets/location-scenes/crash-site-repaired.png")).toBe(true);
  });

  it("writes distinct alt text for each ship state", () => {
    const crashed = crashSite.presentation.scene.alt;
    const repaired = crashSite.stateVariants[0]!.scene!.alt;
    expect(crashed).not.toBe(repaired);
    expect(crashed).toMatch(/crashed/i);
    expect(repaired).toMatch(/repaired/i);
  });

  it("shows the same ship in a Crash Site conversation, from the same repair", () => {
    const crashed = CONVERSATION_BACKGROUND_IDS.crashSiteExterior;
    const repaired = CONVERSATION_BACKGROUND_IDS.crashSiteExteriorRepaired;
    expect(getConversationBackground(crashed)?.asset).toBe(crashSite.presentation.scene.asset);
    expect(getConversationBackground(repaired)?.asset).toBe(
      crashSite.stateVariants[0]!.scene!.asset,
    );
    expect(resolveConversationBackgroundId(crashed, new Set())).toBe(crashed);
    expect(resolveConversationBackgroundId(crashed, new Set([REPAIR_TARGET_IDS.landingGear]))).toBe(
      crashed,
    );
    expect(
      resolveConversationBackgroundId(crashed, new Set([REPAIR_TARGET_IDS.propulsionSystem])),
    ).toBe(repaired);
  });

  it("adds no flight, travel or route state: nothing in the registry can launch", () => {
    for (const location of [crashSite, getLocation(LOCATION_IDS.holoHollow)!]) {
      const resolved = resolveLocationState(
        location,
        facts([REPAIR_TARGET_IDS.propulsionSystem], [MISSION_IDS.thrustIssues]),
      );
      expect(resolved.mapStatus).toBe(location.mapStatus);
    }
    const actions = JSON.stringify(Object.values(ACTION_IDS));
    expect(actions).not.toMatch(/flight|launch|board_ship|fuel|canister/i);
  });
});

describe("the Mission's shape", () => {
  it("passes authored-content validation", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
  });

  it("carries the locked title and summary", () => {
    expect(THRUST_ISSUES.id).toBe(MISSION_IDS.thrustIssues);
    expect(THRUST_ISSUES.title).toBe("Thrust Issues");
    expect(THRUST_ISSUES.summary).toBe(
      "Repair the ship's propulsion system at the Crash Site, then report to Wade Rusk.",
    );
  });

  it("is gated by Wheel Be Right Back and personal Welding 8, and nothing else", () => {
    expect(THRUST_ISSUES.prerequisiteMissionId).toBe(MISSION_IDS.wheelBeRightBack);
    expect(THRUST_ISSUES.prerequisiteSkillLevels).toEqual([
      { skillId: SKILL_IDS.welding, level: 8 },
    ]);
    expect(THRUST_ISSUES.requirements.map((requirement) => requirement.kind)).toEqual([
      "repair_target_complete",
    ]);
  });

  it("is never an automatic continuation from Wheel Be Right Back or anything else", () => {
    expect(WHEEL_BE_RIGHT_BACK.continuationMissionId).toBeUndefined();
    const others: readonly MissionDefinition[] = MISSIONS.filter(
      (mission) => mission.id !== THRUST_ISSUES.id,
    );
    expect(others.some((mission) => mission.continuationMissionId === THRUST_ISSUES.id)).toBe(
      false,
    );
    // And it starts nothing: first flight is a separate slice.
    expect(THRUST_ISSUES.continuationMissionId).toBeUndefined();
  });

  it("is offered by hand by Wade at Rusk Recovery with the locked control", () => {
    expect(THRUST_ISSUES.offers).toEqual([
      {
        npcId: NPC_IDS.wadeRusk,
        locationId: LOCATION_IDS.ruskRecovery,
        dialogueId: DIALOGUE_IDS.wadeThrustIssuesOffer,
        actionLabel: "FIX THE DRIVE",
      },
    ]);
  });

  it("asks for the Propulsion System with the locked objective", () => {
    expect(THRUST_ISSUES.requirements).toEqual([
      {
        kind: "repair_target_complete",
        targetId: REPAIR_TARGET_IDS.propulsionSystem,
        objective: "Repair the Propulsion System at the Crash Site",
      },
    ]);
  });

  it("turns in to Wade at Rusk Recovery and pays nothing", () => {
    expect(THRUST_ISSUES.turnIn).toMatchObject({
      npcId: NPC_IDS.wadeRusk,
      locationId: LOCATION_IDS.ruskRecovery,
      requiresStationary: true,
      objective: "Report the repaired Propulsion System to Wade Rusk at Rusk Recovery",
      actionLabel: "REPORT REPAIR",
    });
    // No XP, Credits or item: the 800 Welding XP is the work's own.
    expect(THRUST_ISSUES.reward).toBeUndefined();
    expect(
      THRUST_ISSUES.offers.some(
        (offer) => "acceptEffect" in offer || "acceptedContinuation" in offer,
      ),
    ).toBe(false);
  });

  it("does not require Refining, Fabrication, A Cut Above or a repeated Cargo Hold gate", () => {
    const skills = (THRUST_ISSUES.prerequisiteSkillLevels ?? []).map((entry) => entry.skillId);
    expect(skills).not.toContain(SKILL_IDS.refining);
    expect(skills).not.toContain(SKILL_IDS.fabrication);
    expect(THRUST_ISSUES.prerequisiteMissionId).not.toBe(MISSION_IDS.aCutAbove);
    expect(THRUST_ISSUES.prerequisiteMissionId).not.toBe(MISSION_IDS.holdItTogether);
  });
});

describe("Wade's locked dialogue", () => {
  const texts = (id: string) => getDialogue(id as never)!.beats.map((beat) => beat.text);
  const expressions = (id: string) =>
    getDialogue(id as never)!.beats.flatMap((beat) =>
      beat.kind === "npc" ? [beat.expressionId] : [],
    );

  it("makes the locked offer, in order and word for word", () => {
    expect(texts(DIALOGUE_IDS.wadeThrustIssuesOffer)).toEqual([
      "Hm. Landing gear's holding. Means there's one big problem left.",
      "Drive itself survived better than it had any right to. Mounts didn't. Both are shot. Frame around them took a hit, too. You try to put thrust through what's there now, best case it tears itself loose.",
      "You'll need two Drive Mounts. Galvaferrite work. One more Galvaferrite for the damaged frame. Two Mounting Brackets. One Galvanic Wire Spool for the ship-side wiring. Then you weld the whole thing back together.",
      "Once you get that fixed, you'll finally be able to get your beater ship off my front lawn.",
    ]);
    expect(expressions(DIALOGUE_IDS.wadeThrustIssuesOffer)).toEqual([
      EXPRESSION_IDS.neutral,
      EXPRESSION_IDS.concerned,
      EXPRESSION_IDS.neutral,
      EXPRESSION_IDS.scowl,
    ]);
  });

  it("gives the locked reminder, word for word", () => {
    expect(texts(DIALOGUE_IDS.wadeThrustIssuesRepairReminder)).toEqual([
      "Two Drive Mounts. One Galvaferrite. Two Mounting Brackets. One Galvanic Wire Spool. Crash Site. Try not to make the hole bigger.",
    ]);
  });

  it("completes with the locked lines word for word, and no reward beat", () => {
    const beats = getDialogue(DIALOGUE_IDS.wadeThrustIssuesCompletion)!.beats;
    expect(beats.map((beat) => beat.kind)).toEqual(["npc", "npc"]);
    expect(beats.map((beat) => beat.text)).toEqual([
      "All right. Landing gear. Propulsion. Hold. Still looks like hell.",
      "But now it's a ship.",
    ]);
    expect(expressions(DIALOGUE_IDS.wadeThrustIssuesCompletion)).toEqual([
      EXPRESSION_IDS.neutral,
      EXPRESSION_IDS.scowl,
    ]);
  });

  it("appends no fuel warning or first-flight prompt anywhere", () => {
    for (const id of [
      DIALOGUE_IDS.wadeThrustIssuesOffer,
      DIALOGUE_IDS.wadeThrustIssuesRepairReminder,
      DIALOGUE_IDS.wadeThrustIssuesBusy,
      DIALOGUE_IDS.wadeThrustIssuesTurnIn,
      DIALOGUE_IDS.wadeThrustIssuesCompletion,
      DIALOGUE_IDS.wadePostThrustIssues,
    ]) {
      expect(texts(id).join(" "), id).not.toMatch(
        /fuel|Stillreach|fly|flight|launch|reserve|tank|Coupler/i,
      );
    }
  });

  it("writes every beat the Mission can reach, so no state falls back to another job's", () => {
    for (const dialogueId of [
      THRUST_ISSUES.offers[0]!.dialogueId,
      THRUST_ISSUES.dialogue.repairReminderDialogueId,
      THRUST_ISSUES.dialogue.busyDialogueId,
      THRUST_ISSUES.turnIn.dialogueId,
      THRUST_ISSUES.dialogue.completionPresentationDialogueId,
      THRUST_ISSUES.completedNpcDialogue?.[0]?.dialogueId,
    ]) {
      expect(dialogueId, "an authored dialogue slot is missing").toBeDefined();
      expect(getDialogue(dialogueId!)?.npcId).toBe(NPC_IDS.wadeRusk);
    }
  });

  it("speaks only with Wade's approved expressions, at his yard, with no exclamation", () => {
    const art = Object.keys(getNpc(NPC_IDS.wadeRusk)?.expressionAssets ?? {});
    for (const id of [
      DIALOGUE_IDS.wadeThrustIssuesOffer,
      DIALOGUE_IDS.wadeThrustIssuesRepairReminder,
      DIALOGUE_IDS.wadeThrustIssuesBusy,
      DIALOGUE_IDS.wadeThrustIssuesTurnIn,
      DIALOGUE_IDS.wadeThrustIssuesCompletion,
      DIALOGUE_IDS.wadePostThrustIssues,
    ]) {
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

  it("lets Wade's follow-up present wherever he is standing", () => {
    expect(getDialogue(DIALOGUE_IDS.wadePostThrustIssues)?.presentsAtCurrentVenue).toBe(true);
  });
});

function observation(
  options: {
    carried?: Record<string, number>;
    installed?: boolean;
    welded?: number;
    weldingLevel?: number;
  } = {},
): MissionObservation {
  const installed = options.installed ?? false;
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map(Object.entries(options.carried ?? {})),
    stackLimits: new Map(),
    itemNames: new Map([
      [ITEM_IDS.driveMount, "Drive Mount"],
      [ITEM_IDS.galvaferrite, "Galvaferrite"],
      [ITEM_IDS.mountingBracket, "Mounting Bracket"],
      [ITEM_IDS.galvanicWireSpool, "Galvanic Wire Spool"],
    ]),
    // Only Welding matters, and no other skill is given any level at all.
    skillLevels: new Map([[SKILL_IDS.welding, options.weldingLevel ?? 8]]),
    repairTargets: new Map([
      [
        REPAIR_TARGET_IDS.propulsionSystem,
        {
          complete: installed,
          materials: propulsion.materials.map((material) => ({
            itemId: material.itemId,
            contributed: installed || (options.welded ?? 0) > 0 ? material.quantity : 0,
            required: material.quantity,
          })),
          welding: {
            completed: installed ? propulsion.repairIncrements : (options.welded ?? 0),
            required: propulsion.repairIncrements,
          },
        },
      ],
    ]),
  };
}

const accepted = { acceptedAt: new Date("2026-10-07T00:00:00.000Z") };
const completed = { ...accepted, completedAt: new Date("2026-10-07T01:00:00.000Z") };

function project(
  mission: { acceptedAt?: Date; completedAt?: Date } | undefined,
  options: Parameters<typeof observation>[0] & { prerequisiteCompleted?: boolean } = {},
  at: string = LOCATION_IDS.ruskRecovery,
): MissionProjection {
  return projectMission(
    THRUST_ISSUES,
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
  it("is not offered before Wheel Be Right Back is complete", () => {
    const locked = project(undefined, { prerequisiteCompleted: false });
    expect(locked.prerequisiteSatisfied).toBe(false);
    expect(
      wadeEntries(locked).some((entry) => entry.dialogueId === DIALOGUE_IDS.wadeThrustIssuesOffer),
    ).toBe(false);
  });

  it("is not offered below Welding 8, even with its Mission prerequisite met", () => {
    for (const weldingLevel of [1, 5, 7]) {
      const short = project(undefined, { weldingLevel });
      expect(short.prerequisiteSatisfied, `Welding ${weldingLevel}`).toBe(false);
      expect(
        wadeEntries(short).some((entry) => entry.dialogueId === DIALOGUE_IDS.wadeThrustIssuesOffer),
      ).toBe(false);
      expect(
        missionSkillPrerequisiteSatisfied(
          THRUST_ISSUES,
          new Map([[SKILL_IDS.welding, weldingLevel]]),
        ),
      ).toBe(false);
    }
  });

  it("is offered manually at Welding 8, whatever the other skills are", () => {
    const available = project(undefined);
    expect(available.state).toBe("not_accepted");
    expect(available.prerequisiteSatisfied).toBe(true);
    expect(available.guidance?.availableNpcIds).toEqual([NPC_IDS.wadeRusk]);
    expect(wadeEntries(available)[0]).toMatchObject({
      kind: "mission",
      role: "offer",
      dialogueId: DIALOGUE_IDS.wadeThrustIssuesOffer,
      action: { kind: "accept_mission", label: "FIX THE DRIVE" },
    });
  });

  it("reminds without a command however far the work has got", () => {
    for (const welded of [0, 4, 15]) {
      const active = project(accepted, { welded });
      expect(active.state).toBe("active");
      const [reminder] = wadeEntries(active);
      expect(reminder).toMatchObject({
        role: "active",
        dialogueId: DIALOGUE_IDS.wadeThrustIssuesRepairReminder,
      });
      expect(reminder && "action" in reminder ? reminder.action : undefined).toBeUndefined();
    }
  });

  it("guides the Propulsion System wherever the player carries parts for it, and not before", () => {
    expect([...deriveMissionGuidanceTargets([project(accepted)]).repairTargetIds]).toEqual([]);
    // Mounts bought or traded from another player count exactly like fabricated ones.
    const carrying = project(accepted, { carried: { [ITEM_IDS.driveMount]: 2 } });
    expect([...deriveMissionGuidanceTargets([carrying]).repairTargetIds]).toEqual([
      REPAIR_TARGET_IDS.propulsionSystem,
    ]);
    expect(carrying.guidance).toMatchObject({
      repairTargetId: REPAIR_TARGET_IDS.propulsionSystem,
      locationId: LOCATION_IDS.crashSite,
    });
  });

  it("turns to Wade the moment the Propulsion System is complete", () => {
    const installed = project(accepted, { installed: true });
    expect(installed.state).toBe("ready_for_completion");
    expect(wadeEntries(installed)[0]).toMatchObject({
      role: "turn_in",
      dialogueId: DIALOGUE_IDS.wadeThrustIssuesTurnIn,
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
      dialogueId: DIALOGUE_IDS.wadePostThrustIssues,
    });
    expect(done.some((entry) => "action" in entry && entry.action)).toBe(false);
  });

  it("replays nothing: a completed Mission is not offered or accepted again", () => {
    const done = project(completed, { installed: true });
    expect(done.state).toBe("completed");
    expect(done.guidance).toBeUndefined();
  });
});
