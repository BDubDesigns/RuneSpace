import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getRepairTargetBalance,
  runeworkingRecipes,
  weldingActionIds,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import {
  getConversationBackground,
  getConversationBackgroundPlaceName,
} from "@/game/content/conversation-backgrounds";
import { getDialogue } from "@/game/content/dialogue";
import { getLocation, isActionAvailableAtLocation } from "@/game/content/locations";
import {
  A_PLACE_TO_CALL_HOME,
  A_RUNE_OF_YOUR_OWN,
  getMission,
  MISSIONS,
} from "@/game/content/missions";
import { getNpc, getResidentNpcs, resolveNpcPlacement } from "@/game/content/npcs";
import { getRepairTarget } from "@/game/content/repair-targets";
import { RUNEWORKING_STATIONS, getRuneworkingStation } from "@/game/content/resonance-rig";
import { teleportDestinationPresentation } from "@/game/content/rune-teleports";
import { resolveNpcConversation, type NpcConversationProjection } from "@/game/domain/conversation";
import { resolveLocationState } from "@/game/domain/location-state";
import {
  missionRequiredSkillLevel,
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
} from "@/game/domain/missions";
import { LOCATIONS } from "@/game/content/locations";
import {
  resolveItemSources,
  type ItemSource,
  type ItemSourceFacts,
} from "@/game/domain/item-sources";
import {
  RUNEWORKING_WIKI_PATH,
  runeworkingCanStart,
  runeworkingCommitmentNote,
  runeworkingRecipeLine,
  runeworkingUnmetRequirements,
} from "@/features/runeworking/rig-copy";
import { getWikiArticle } from "@/features/public-site/public-wiki";
import type { RuneworkingRecipeProjection } from "@/server/play";
import { readImageHeader } from "./image-header";

/**
 * Issue #441 — the authored contract of the personal Resonance Rig chapter: the
 * approved art, the recipe, the Rig repair, both Missions, the Enby's derived
 * placement and the verbatim approved dialogue. Server authority and the player's
 * path are proven against PostgreSQL in `tests/integration/resonance-rig.test.ts`.
 */

const balance = getEffectiveGameBalance();
const crashSite = getLocation(LOCATION_IDS.crashSite)!;
const enby = getNpc(NPC_IDS.wiseOldEnby)!;
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const sayings = (dialogueId: string) =>
  getDialogue(dialogueId)!.beats.map((beat) => ({
    expression: beat.kind === "npc" ? beat.expressionId : beat.kind,
    text: beat.text,
  }));

describe("the approved artwork", () => {
  it("keeps the owner-approved master byte for byte, and derives one runtime overlay", () => {
    expect(sha256("assets/location-scenes/resonance-rig-master.png")).toBe(
      "2d873b23405a111760ae815e90822727b9b5984ddc80c5f11210d29c6e474d30",
    );
    expect(readImageHeader("assets/location-scenes/resonance-rig-master.png")).toMatchObject({
      width: 1536,
      height: 1024,
      container: "png",
    });
    const overlay = crashSite.stateVariants.find(
      (variant) => variant.id === "crash_site_resonance_site",
    )!.scene!.overlay!;
    expect(overlay.asset).toBe("/location-scenes/resonance-rig.webp");
    const header = readImageHeader(`public${overlay.asset}`);
    // The 3:2 master canvas is only scaled, never trimmed: registration is the approval.
    expect(header).toMatchObject({ width: overlay.width, height: overlay.height });
    expect(overlay.width / overlay.height).toBeCloseTo(1536 / 1024, 5);
    expect(header.hasAlpha).toBe(true);
  });

  it("places the Rig exactly where the owner approved, as percent of the shared stage", () => {
    const state = resolveLocationState(crashSite, {
      acceptedMissionIds: new Set(),
      completedRepairTargetIds: new Set([REPAIR_TARGET_IDS.resonanceRig]),
    });
    expect(state.scene.overlay?.placement).toEqual({ left: 36.5, top: 20, width: 29 });
    expect(state.scene.focal).toEqual({ x: 50, y: 50 });
  });

  it("adds no new background and does not touch the early-game Rivet compositions", () => {
    expect(existsSync("public/location-scenes/crash-site-empty.webp")).toBe(true);
    // The base scene is still the crashed Rivet, and the repaired and departed variants remain.
    expect(crashSite.presentation.scene.overlay?.asset).toBe("/location-scenes/rivet-crashed.webp");
    const variants = new Map(crashSite.stateVariants.map((variant) => [variant.id, variant]));
    expect(variants.get("crash_site_ship_restored")?.scene?.overlay?.asset).toBe(
      "/location-scenes/rivet-repaired.webp",
    );
    expect(variants.get("crash_site_ship_departed")?.scene?.overlay).toBeUndefined();
    // Authored most specific first: the Rig wins, then the departed ship, then the repaired one.
    expect(crashSite.stateVariants.map((variant) => variant.id)).toEqual([
      "crash_site_resonance_site",
      "crash_site_ship_departed",
      "crash_site_ship_restored",
    ]);
  });

  it("shows empty background + Rig, never a Rivet, even with the ship repaired and parked", () => {
    const facts = {
      acceptedMissionIds: new Set<string>(),
      completedRepairTargetIds: new Set([
        REPAIR_TARGET_IDS.propulsionSystem,
        REPAIR_TARGET_IDS.resonanceRig,
      ]),
    };
    for (const shipBerthLocationId of [
      undefined,
      LOCATION_IDS.crashSite,
      LOCATION_IDS.holoHollowLanding,
    ]) {
      const state = resolveLocationState(crashSite, {
        ...facts,
        ...(shipBerthLocationId ? { shipBerthLocationId } : {}),
      });
      expect(state.scene.overlay?.asset).toBe("/location-scenes/resonance-rig.webp");
      expect(state.displayName).toBe("Resonance Site");
      expect(state.locationId).toBe(LOCATION_IDS.crashSite);
    }
  });

  it("keeps the early-game scenes and name untouched without a finished Rig", () => {
    const crashed = resolveLocationState(crashSite);
    expect(crashed.displayName).toBe("Crash Site");
    expect(crashed.scene.overlay?.asset).toBe("/location-scenes/rivet-crashed.webp");
    const departed = resolveLocationState(crashSite, {
      acceptedMissionIds: new Set(),
      completedRepairTargetIds: new Set(),
      shipBerthLocationId: LOCATION_IDS.holoHollowLanding,
    });
    expect(departed.displayName).toBe("Crash Site");
    expect(departed.scene.overlay).toBeUndefined();
  });

  it("gives the 15:8 conversation the same stage the 4:1 header uses", () => {
    const background = getConversationBackground(
      CONVERSATION_BACKGROUND_IDS.crashSiteResonanceSite,
    )!;
    const variant = crashSite.stateVariants.find(
      (candidate) => candidate.id === "crash_site_resonance_site",
    )!;
    expect(background.composition).toBe(variant.scene);
    expect(getConversationBackgroundPlaceName(background.id)).toBe("Resonance Site");
  });
});

describe("the Rig repair and the Skatboll TP Rune recipe", () => {
  const rig = getRepairTargetBalance(REPAIR_TARGET_IDS.resonanceRig, balance);

  it("installs exactly the approved bill once, then 24 sections for 1,200 base Welding XP", () => {
    expect(rig.materials).toEqual([
      { itemId: ITEM_IDS.resonanceCore, quantity: 1 },
      { itemId: ITEM_IDS.galvaferrite, quantity: 3 },
      { itemId: ITEM_IDS.mountingBracket, quantity: 4 },
      { itemId: ITEM_IDS.galvanicWireSpool, quantity: 1 },
      { itemId: ITEM_IDS.powerCell, quantity: 2 },
    ]);
    expect(rig.repairIncrements).toBe(24);
    expect(rig.repairIncrements * balance.welding.xpPerIncrement).toBe(1200);
    expect(weldingActionIds(balance)).toContain(ACTION_IDS.resonanceRigWelding);
  });

  it("is the Crash Site's own Mission-authorized repair, with Welding 12 read from the Mission", () => {
    const target = getRepairTarget(REPAIR_TARGET_IDS.resonanceRig)!;
    expect(target.locationId).toBe(LOCATION_IDS.crashSite);
    expect(target.authorization).toEqual({
      kind: "mission",
      missionId: MISSION_IDS.aPlaceToCallHome,
      requiresMissionWeldingLevel: true,
    });
    // One home for the level: the Mission's own first objective.
    expect(missionRequiredSkillLevel(A_PLACE_TO_CALL_HOME, SKILL_IDS.welding)).toBe(12);
    expect(
      A_PLACE_TO_CALL_HOME.prerequisiteSkillLevels?.some((p) => p.skillId === SKILL_IDS.welding),
    ).toBe(false);
    expect(crashSite.availableActionIds).toContain(ACTION_IDS.resonanceRigWelding);
  });

  it("crafts 1 Cut Quartz + 1 intact Runestone into 1 ordinary TP Rune: RW 5, 48 ticks, 125 XP", () => {
    const recipe = runeworkingRecipes(balance).find(
      (candidate) => candidate.actionId === ACTION_IDS.skatbollTpRuneRuneworking,
    )!;
    expect(recipe).toEqual({
      actionId: ACTION_IDS.skatbollTpRuneRuneworking,
      outputItemId: ITEM_IDS.skatbollTpRune,
      outputQuantity: 1,
      minimumLevel: 5,
      durationTicks: 48,
      baseXp: 125,
      inputs: [
        { itemId: ITEM_IDS.cutQuartz, quantity: 1 },
        { itemId: ITEM_IDS.runestone, quantity: 1 },
      ],
    });
    // 48 ticks of 600 ms.
    expect((recipe.durationTicks * 600) / 1000).toBe(28.8);
    // The existing item, unchanged: no new item, mass or stack rule.
    expect(balance.items.skatbollTpRune).toMatchObject({ massGrams: 1_100, stackLimit: 5 });
  });

  it("hosts the recipe only at the personal Rig's location, and the Seeker only at Hilltop", () => {
    expect(
      isActionAvailableAtLocation(LOCATION_IDS.crashSite, ACTION_IDS.skatbollTpRuneRuneworking),
    ).toBe(true);
    expect(
      isActionAvailableAtLocation(
        LOCATION_IDS.hilltopWorkshop,
        ACTION_IDS.skatbollTpRuneRuneworking,
      ),
    ).toBe(false);
    expect(
      isActionAvailableAtLocation(LOCATION_IDS.crashSite, ACTION_IDS.beginnerEchoSeekerRuneworking),
    ).toBe(false);
    expect(RUNEWORKING_STATIONS.map((station) => station.locationId)).toEqual([
      LOCATION_IDS.hilltopWorkshop,
      LOCATION_IDS.crashSite,
    ]);
    // Opened by derived facts the game already records, never a flag of its own.
    expect(getRuneworkingStation(LOCATION_IDS.crashSite)?.unlock).toEqual({
      kind: "repair_completed",
      targetId: REPAIR_TARGET_IDS.resonanceRig,
    });
    expect(getRuneworkingStation(LOCATION_IDS.theJag)).toBeUndefined();
  });
});

describe("the Missions", () => {
  it("validates with the rest of the registry", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
    expect(getMission(MISSION_IDS.aPlaceToCallHome)).toBe(A_PLACE_TO_CALL_HOME);
    expect(getMission(MISSION_IDS.aRuneOfYourOwn)).toBe(A_RUNE_OF_YOUR_OWN);
  });

  it("offers A Place to Call Home by hand at Hilltop after the lesson and Runeworking 5", () => {
    expect(A_PLACE_TO_CALL_HOME.prerequisiteMissionId).toBe(MISSION_IDS.firstRuneworkingLesson);
    expect(A_PLACE_TO_CALL_HOME.prerequisiteSkillLevels).toEqual([
      { skillId: SKILL_IDS.runeworking, level: 5 },
    ]);
    // No First Echo prerequisite and no Welding acceptance gate.
    expect(A_PLACE_TO_CALL_HOME.prerequisiteMissionId).not.toBe(MISSION_IDS.firstResonanceEcho);
    expect(A_PLACE_TO_CALL_HOME.offers).toEqual([
      {
        npcId: NPC_IDS.wiseOldEnby,
        locationId: LOCATION_IDS.hilltopWorkshop,
        dialogueId: DIALOGUE_IDS.wiseOldEnbyHomeOffer,
        actionLabel: "Accept Mission",
        declineLabel: "Not Now",
        acceptedContinuation: { dialogueId: DIALOGUE_IDS.wiseOldEnbyHomeAccepted },
      },
    ]);
    expect(A_PLACE_TO_CALL_HOME.requirements.map((requirement) => requirement.kind)).toEqual([
      "skill_level",
      "repair_target_complete",
    ]);
  });

  it("turns in at the Crash Site for exactly two TP Runes and no XP, then continues into Mission 2", () => {
    expect(A_PLACE_TO_CALL_HOME.turnIn).toMatchObject({
      npcId: NPC_IDS.wiseOldEnby,
      locationId: LOCATION_IDS.crashSite,
      requiresStationary: true,
    });
    expect(A_PLACE_TO_CALL_HOME.reward).toEqual({
      kind: "stack_bundle",
      items: [{ itemId: ITEM_IDS.skatbollTpRune, quantity: 2 }],
    });
    expect(A_PLACE_TO_CALL_HOME.continuationMissionId).toBe(MISSION_IDS.aRuneOfYourOwn);
  });

  it("makes A Rune of Your Own an offerless continuation: one genuine craft, +500 XP, nothing taken", () => {
    expect(A_RUNE_OF_YOUR_OWN.offers).toEqual([]);
    expect(A_RUNE_OF_YOUR_OWN.itemOffer).toBeUndefined();
    expect(A_RUNE_OF_YOUR_OWN.requirements).toEqual([
      expect.objectContaining({
        kind: "tracked_activity",
        activity: "runeworking",
        metric: "completions",
        actionId: ACTION_IDS.skatbollTpRuneRuneworking,
        target: 1,
      }),
    ]);
    // No carried-rune requirement and no item debit anywhere on the Mission.
    expect(A_RUNE_OF_YOUR_OWN.requirements.some((r) => r.kind === "carried_stack")).toBe(false);
    expect(A_RUNE_OF_YOUR_OWN.reward).toEqual({
      kind: "skill_xp",
      skillId: SKILL_IDS.runeworking,
      amount: 500,
    });
    expect(A_RUNE_OF_YOUR_OWN.turnIn?.locationId).toBe(LOCATION_IDS.crashSite);
  });

  it("shows Welding as the first live objective, met at once at 12", () => {
    const observe = (welding: number, rigComplete = false): MissionObservation => ({
      equippedItemIds: new Set(),
      carriedQuantities: new Map(),
      stackLimits: new Map(),
      itemNames: new Map(),
      skillLevels: new Map([[SKILL_IDS.welding, welding]]),
      repairTargets: new Map([
        [
          REPAIR_TARGET_IDS.resonanceRig,
          {
            complete: rigComplete,
            materials: [],
            welding: { completed: rigComplete ? 24 : 0, required: 24 },
          },
        ],
      ]),
    });
    const project = (welding: number, at: string) =>
      projectMission(
        A_PLACE_TO_CALL_HOME,
        { acceptedAt: new Date() },
        at,
        true,
        observe(welding),
        true,
      );
    const low = project(7, LOCATION_IDS.hilltopWorkshop);
    expect(low.currentObjective).toBe("Reach Welding level 12 — currently 7");
    expect(low.requirements?.[0]).toMatchObject({
      satisfied: false,
      progress: { current: 7, target: 12 },
    });
    const ready = project(12, LOCATION_IDS.hilltopWorkshop);
    expect(ready.requirements?.[0]).toMatchObject({ satisfied: true });
    expect(ready.requirements?.[1]).toMatchObject({ satisfied: false });
  });
});

describe("the Wise Old Enby's one derived placement", () => {
  const at = (completedMissionIds: string[], completedRepairTargetIds: string[]) =>
    resolveNpcPlacement(enby, new Set(completedMissionIds), new Set(completedRepairTargetIds))
      .locationId;

  it("is at Hilltop, then at the Crash Site from the Rig's completion until Mission 2 ends", () => {
    expect(at([], [])).toBe(LOCATION_IDS.hilltopWorkshop);
    // Mission 1 accepted but the Rig not finished: still at home.
    expect(at([], [])).toBe(LOCATION_IDS.hilltopWorkshop);
    expect(at([], [REPAIR_TARGET_IDS.resonanceRig])).toBe(LOCATION_IDS.crashSite);
    // After Mission 1's turn-in, still at the site.
    expect(at([MISSION_IDS.aPlaceToCallHome], [REPAIR_TARGET_IDS.resonanceRig])).toBe(
      LOCATION_IDS.crashSite,
    );
    // After Mission 2: home again, and the Rig stays.
    expect(
      at(
        [MISSION_IDS.aPlaceToCallHome, MISSION_IDS.aRuneOfYourOwn],
        [REPAIR_TARGET_IDS.resonanceRig],
      ),
    ).toBe(LOCATION_IDS.hilltopWorkshop);
  });

  it("is never at two places, and never at the Crash Site for a character without the Rig", () => {
    const residents = (locationId: string, repairs: string[], missions: string[] = []) =>
      getResidentNpcs({
        locationId,
        completedMissionIds: new Set(missions),
        completedRepairTargetIds: new Set(repairs),
      }).filter((npc) => npc.id === NPC_IDS.wiseOldEnby);
    const rig = [REPAIR_TARGET_IDS.resonanceRig];
    expect(residents(LOCATION_IDS.crashSite, rig)).toHaveLength(1);
    expect(residents(LOCATION_IDS.hilltopWorkshop, rig)).toHaveLength(0);
    expect(residents(LOCATION_IDS.crashSite, [])).toHaveLength(0);
    expect(residents(LOCATION_IDS.hilltopWorkshop, [])).toHaveLength(1);
  });

  it("keeps Wade at the Crash Site relocation rules and every other NPC unchanged", () => {
    expect(getNpc(NPC_IDS.wadeRusk)!.relocations?.every((r) => r.afterCompletedMissionId)).toBe(
      true,
    );
    expect(
      resolveNpcPlacement(
        getNpc(NPC_IDS.werner)!,
        new Set(),
        new Set([REPAIR_TARGET_IDS.resonanceRig]),
      ).locationId,
    ).toBe(LOCATION_IDS.wernersLab);
  });
});

describe("the teleport destination label", () => {
  it("reads Crash Site until the character's own Rig stands there, then Resonance Site", () => {
    const base = {
      acceptedMissionIds: new Set<string>(),
      completedRepairTargetIds: new Set<string>(),
    };
    expect(teleportDestinationPresentation(LOCATION_IDS.crashSite).name).toBe("Crash Site");
    expect(teleportDestinationPresentation(LOCATION_IDS.crashSite, base).name).toBe("Crash Site");
    expect(
      teleportDestinationPresentation(LOCATION_IDS.crashSite, {
        ...base,
        completedRepairTargetIds: new Set([REPAIR_TARGET_IDS.resonanceRig]),
      }),
    ).toMatchObject({ name: "Resonance Site", locationId: LOCATION_IDS.crashSite });
  });
});

describe("the approved Enby script, verbatim", () => {
  it("plays the offer in the approved order with the approved expressions", () => {
    expect(sayings(DIALOGUE_IDS.wiseOldEnbyHomeOffer)).toEqual([
      {
        expression: "friendly",
        text: "Ah, there you are! I've been going over some old readings from Skatboll. Your Crash Site, specifically.",
      },
      {
        expression: "thoughtful",
        text: "There's a natural resonance point beneath that wreckage. Quite a stable one, considering the way you introduced yourself to the planet.",
      },
      {
        expression: "thoughtful",
        text: "A Rig built on that point could attune teleport runes. Carry one elsewhere, and it would know exactly where to bring you back.",
      },
      {
        expression: "neutral",
        text: "Not because of who made it, mind you. The rune remembers the place, not the person.",
      },
      {
        expression: "thoughtful",
        text: "You've learned to listen to RuneSpace. Now I'd like you to build something that can work with it. A Resonance Core, a good deal of metalwork, and Welding level twelve.",
      },
      {
        expression: "amused",
        text: "I can give you the measurements. I would offer to do the welding myself, but we have both seen enough questionable engineering for one lifetime.",
      },
      {
        expression: "friendly",
        text: "Fancy turning that Crash Site into something worth coming home to?",
      },
    ]);
  });

  it("plays the accepted instructions and both contextual reminders", () => {
    expect(sayings(DIALOGUE_IDS.wiseOldEnbyHomeAccepted).map((s) => s.expression)).toEqual([
      "friendly",
      "thoughtful",
      "friendly",
    ]);
    expect(sayings(DIALOGUE_IDS.wiseOldEnbyHomeAccepted)[1]!.text).toBe(
      "You'll need one Resonance Core, three Galvaferrite, four Mounting Brackets, a Galvanic Wire Spool, and two Power Cells. I've made a list. Best not to trust either of us to remember all of it.",
    );
    expect(sayings(DIALOGUE_IDS.wiseOldEnbyHomeSkillReminder)).toEqual([
      {
        expression: "friendly",
        text: "How's the Welding coming along? No hurry. The resonance point's been there longer than either of us, and I doubt it's about to move.",
      },
    ]);
    expect(sayings(DIALOGUE_IDS.wiseOldEnbyHomeRepairReminder)).toEqual([
      {
        expression: "thoughtful",
        text: "You're ready to build. Materials at the Crash Site, then twenty-four careful welds. Best to let the Core do the clever part.",
      },
    ]);
  });

  it("plays the visit before the turn-in, then the two-rune item beat and the lesson", () => {
    expect(sayings(DIALOGUE_IDS.wiseOldEnbyHomeTurnIn).map((s) => s.expression)).toEqual([
      "friendly",
      "thoughtful",
      "friendly",
      "thoughtful",
      "friendly",
    ]);
    expect(sayings(DIALOGUE_IDS.wiseOldEnbyHomeTurnIn)[4]!.text).toBe(
      "And I brought two more for you. Consider them a practical demonstration.",
    );
    const completion = getDialogue(DIALOGUE_IDS.wiseOldEnbyHomeCompletion)!;
    // The reward art is an item beat for exactly the granted bundle, with the approved caption.
    expect(completion.beats[0]).toMatchObject({
      kind: "item",
      itemId: ITEM_IDS.skatbollTpRune,
      quantity: 2,
      text: "Enby hands you two Skatboll TP Runes.",
    });
    expect(completion.beats.slice(1).map((beat) => beat.text)).toEqual([
      "Making the rune itself is quite straightforward once you've learned how. It's finding the materials that keeps me from popping about every time I forget something.",
      "Your Rig is anchored to this place. A rune made here will remember Skatboll, regardless of who eventually uses it.",
      "One Cut Quartz and one Intact Runestone. Bring them to your Rig, attune a rune of your own, and let it finish properly.",
      "Come and tell me when you've done it. I think I'll stay a little while.",
    ]);
  });

  it("plays Mission 2's reminder, turn-in opening and completion", () => {
    expect(sayings(DIALOGUE_IDS.wiseOldEnbyRuneReminder).map((s) => s.expression)).toEqual([
      "friendly",
      "thoughtful",
      "amused",
    ]);
    const opening = sayings(DIALOGUE_IDS.wiseOldEnbyRuneTurnIn);
    expect(opening).toHaveLength(6);
    expect(opening[3]!.text).toBe(
      "Keep your rune. You've earned it. I came to teach, not to collect souvenirs.",
    );
    expect(opening[5]!.text).toBe(
      "Well, I should be getting back to Stillreach. My rune will take me to The Low Hum. Still a bit of a walk from there to the workshop, I'm afraid.",
    );
    const completion = getDialogue(DIALOGUE_IDS.wiseOldEnbyRuneCompletion)!;
    expect(completion.beats[0]).toMatchObject({
      kind: "skill_xp",
      skillId: SKILL_IDS.runeworking,
      amount: 500,
    });
    expect(completion.beats[1]!.text).toBe(
      "Do come visit, won't you? I suspect you've barely scratched the surface of what RuneSpace can do.",
    );
    // The departure plays over the farewell and then the conversation ends.
    expect(completion.exitCueSequenceId).toBe("resonance_rig_departure");
  });

  it("authors every Rig beat against the Resonance Site, never the repaired Rivet", () => {
    for (const id of [
      DIALOGUE_IDS.wiseOldEnbyHomeTurnIn,
      DIALOGUE_IDS.wiseOldEnbyHomeCompletion,
      DIALOGUE_IDS.wiseOldEnbyHomeCapacity,
      DIALOGUE_IDS.wiseOldEnbyRuneReminder,
      DIALOGUE_IDS.wiseOldEnbyRuneTurnIn,
      DIALOGUE_IDS.wiseOldEnbyRuneCompletion,
    ]) {
      for (const beat of getDialogue(id)!.beats) {
        expect(beat.backgroundId, id).toBe(CONVERSATION_BACKGROUND_IDS.crashSiteResonanceSite);
      }
    }
  });
});

describe("the conversation routing", () => {
  const projection = (
    missionId: string,
    state: "not_accepted" | "active" | "ready_for_completion" | "completed",
    extra: Partial<NpcConversationProjection> = {},
  ): NpcConversationProjection =>
    ({
      missionId,
      state,
      prerequisiteSatisfied: true,
      ...extra,
    }) as NpcConversationProjection;

  it("never offers A Rune of Your Own: with Mission 1 done and Mission 2 active there is no offer", () => {
    const entries = resolveNpcConversation(NPC_IDS.wiseOldEnby, [
      projection(MISSION_IDS.aPlaceToCallHome, "completed"),
      projection(MISSION_IDS.aRuneOfYourOwn, "active", {
        stage: {
          requirementsSatisfied: false,
          turnInAvailable: false,
          nextObjectiveKind: "tracked_activity",
        } as never,
      }),
    ]);
    const missionEntries = entries.filter((entry) => entry.kind === "mission");
    expect(missionEntries.map((entry) => entry.dialogueId)).toEqual([
      DIALOGUE_IDS.wiseOldEnbyRuneReminder,
    ]);
    expect(missionEntries.every((entry) => entry.action === undefined)).toBe(true);
  });
});

describe("item sources follow the Rig stations the character has", () => {
  const facts = (stations: readonly string[], rigBuilt: boolean): ItemSourceFacts => ({
    skillLevels: { [SKILL_IDS.runeworking]: 5 },
    acceptedMissionIds: new Set(),
    completedMissionIds: new Set(),
    fabricationStationUnlocked: false,
    resonanceRigUnlocked: stations.length > 0,
    resonanceStationLocationIds: new Set(stations),
    locationStates: Object.fromEntries(
      LOCATIONS.map((location) => [
        location.id,
        resolveLocationState(location, {
          acceptedMissionIds: new Set(),
          completedRepairTargetIds: new Set(rigBuilt ? [REPAIR_TARGET_IDS.resonanceRig] : []),
        }),
      ]),
    ),
  });
  const runework = (itemId: string, source: ItemSourceFacts) =>
    resolveItemSources(itemId, source).filter(
      (entry): entry is Extract<ItemSource, { locationIds: readonly string[] }> =>
        entry.kind === "runework" && "locationIds" in entry,
    );

  it("offers the TP Rune only from the character's own Rig, at the Crash Site", () => {
    const own = runework(
      ITEM_IDS.skatbollTpRune,
      facts([LOCATION_IDS.hilltopWorkshop, LOCATION_IDS.crashSite], true),
    );
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      recipeActionId: ACTION_IDS.skatbollTpRuneRuneworking,
      locationIds: [LOCATION_IDS.crashSite],
      minimumLevel: 5,
      access: { state: "available" },
    });
    // Without the Rig it is not a source at all: the Wise Old Enby's Rig does not make it.
    expect(runework(ITEM_IDS.skatbollTpRune, facts([LOCATION_IDS.hilltopWorkshop], false))).toEqual(
      [],
    );
  });

  it("keeps the Seeker at Hilltop whichever Rigs the character has, wherever they stand", () => {
    for (const stations of [
      [LOCATION_IDS.hilltopWorkshop],
      [LOCATION_IDS.hilltopWorkshop, LOCATION_IDS.crashSite],
    ]) {
      const seeker = runework(ITEM_IDS.beginnerEchoSeeker, facts(stations, stations.length > 1));
      expect(seeker.map((entry) => entry.locationIds)).toEqual([[LOCATION_IDS.hilltopWorkshop]]);
    }
  });
});

describe("the Enby's Mission 1 conversations follow the live objective", () => {
  const observe = (welding: number, rigComplete: boolean): MissionObservation => ({
    equippedItemIds: new Set(),
    carriedQuantities: new Map(),
    stackLimits: new Map(),
    itemNames: new Map(),
    skillLevels: new Map([[SKILL_IDS.welding, welding]]),
    repairTargets: new Map([
      [
        REPAIR_TARGET_IDS.resonanceRig,
        {
          complete: rigComplete,
          materials: [],
          welding: { completed: rigComplete ? 24 : 0, required: 24 },
        },
      ],
    ]),
  });
  const entriesAt = (welding: number, rigComplete: boolean, at: string) => {
    const projection = projectMission(
      A_PLACE_TO_CALL_HOME,
      { acceptedAt: new Date() },
      at,
      true,
      observe(welding, rigComplete),
      true,
    );
    return resolveNpcConversation(NPC_IDS.wiseOldEnby, [projection]).filter(
      (entry) => entry.kind === "mission",
    );
  };

  it("plays the Welding reminder below 12, with no command and no travel to the Enby needed", () => {
    const [entry] = entriesAt(8, false, LOCATION_IDS.hilltopWorkshop);
    expect(entry?.dialogueId).toBe(DIALOGUE_IDS.wiseOldEnbyHomeSkillReminder);
    expect(entry?.action).toBeUndefined();
  });

  it("plays the build reminder at Welding 12 until the Rig is finished", () => {
    const [entry] = entriesAt(12, false, LOCATION_IDS.hilltopWorkshop);
    expect(entry?.dialogueId).toBe(DIALOGUE_IDS.wiseOldEnbyHomeRepairReminder);
    expect(entry?.action).toBeUndefined();
  });

  it("opens the explicit turn-in once the Rig is finished, carrying the complete command", () => {
    const [entry] = entriesAt(12, true, LOCATION_IDS.crashSite);
    expect(entry?.dialogueId).toBe(DIALOGUE_IDS.wiseOldEnbyHomeTurnIn);
    expect(entry?.action).toMatchObject({
      kind: "complete_mission",
      label: "Complete A Place to Call Home",
    });
  });

  it("is not performable anywhere but the Crash Site, however ready the Mission is", () => {
    const projection = projectMission(
      A_PLACE_TO_CALL_HOME,
      { acceptedAt: new Date() },
      LOCATION_IDS.hilltopWorkshop,
      true,
      observe(12, true),
      true,
    );
    expect(projection.state).not.toBe("ready_for_completion");
    expect(projection.stage?.requirementsSatisfied).toBe(true);
    expect(projection.stage?.turnInAvailable).toBe(false);
  });
});

describe("the shared station panel presents one local recipe honestly (#441)", () => {
  const recipe = (
    actionId: string,
    carried: Record<string, number>,
    over: Partial<RuneworkingRecipeProjection> = {},
  ): RuneworkingRecipeProjection => {
    const source = runeworkingRecipes(balance).find((entry) => entry.actionId === actionId)!;
    const inputs = source.inputs.map((input) => ({
      itemId: input.itemId,
      name:
        input.itemId === ITEM_IDS.runeFragment
          ? "Rune Fragment"
          : input.itemId === ITEM_IDS.cutQuartz
            ? "Cut Quartz"
            : "Runestone",
      quantity: input.quantity,
      carried: carried[input.itemId] ?? 0,
    }));
    return {
      actionId,
      outputItemId: source.outputItemId,
      outputName:
        actionId === ACTION_IDS.skatbollTpRuneRuneworking
          ? "Skatboll TP Rune"
          : "Beginner Echo Seeker",
      outputQuantity: 1,
      outputStackLimit: 5,
      minimumLevel: source.minimumLevel,
      unlocked: true,
      durationTicks: source.durationTicks,
      baseXp: source.baseXp,
      inputs,
      inputsAvailable: inputs.every((input) => input.carried >= input.quantity),
      affordableCycles: Math.min(
        ...inputs.map((input) => Math.floor(input.carried / input.quantity)),
      ),
      ...over,
    };
  };
  const idle = { activityRunning: false, foregroundBusy: false };

  it("never lights Start for a recipe it cannot run: missing a Runestone, level, activity or command", () => {
    const quartzOnly = recipe(ACTION_IDS.skatbollTpRuneRuneworking, { [ITEM_IDS.cutQuartz]: 2 });
    expect(quartzOnly.affordableCycles).toBe(0);
    expect(runeworkingCanStart(quartzOnly, idle)).toBe(false);
    expect(runeworkingUnmetRequirements(quartzOnly, 5)).toEqual(["Need 1 more Runestone"]);

    const both = recipe(ACTION_IDS.skatbollTpRuneRuneworking, {
      [ITEM_IDS.cutQuartz]: 2,
      [ITEM_IDS.runestone]: 1,
    });
    expect(runeworkingCanStart(both, idle)).toBe(true);
    expect(runeworkingUnmetRequirements(both, 5)).toEqual([]);
    expect(runeworkingCanStart(both, { ...idle, activityRunning: true })).toBe(false);
    expect(runeworkingCanStart(both, { ...idle, foregroundBusy: true })).toBe(false);
    expect(runeworkingCanStart({ ...both, unlocked: false }, idle)).toBe(false);
  });

  it("explains reserved inputs from the selected recipe, never another station's", () => {
    const tp = runeworkingCommitmentNote(
      recipe(ACTION_IDS.skatbollTpRuneRuneworking, {
        [ITEM_IDS.cutQuartz]: 1,
        [ITEM_IDS.runestone]: 1,
      }),
    );
    expect(tp).toContain("its Cut Quartz and Runestone stay reserved");
    expect(tp).not.toContain("Rune Fragment");
    const seeker = runeworkingCommitmentNote(
      recipe(ACTION_IDS.beginnerEchoSeekerRuneworking, { [ITEM_IDS.runeFragment]: 1 }),
    );
    expect(seeker).toContain("its Rune Fragment stays reserved");
    expect(seeker).not.toContain("Cut Quartz");
    // The real rule is kept: committed, and no walking away.
    for (const note of [tp, seeker]) {
      expect(note).toMatch(/committed/);
      expect(note).toMatch(/cannot leave the Rig/);
    }
    expect(runeworkingRecipeLine(recipe(ACTION_IDS.skatbollTpRuneRuneworking, {}))).toBe(
      "1 Cut Quartz + 1 Runestone → 1 Skatboll TP Rune",
    );
  });

  it("links to a real Runeworking Wiki article that lists every implemented recipe and where it is made", () => {
    expect(RUNEWORKING_WIKI_PATH).toBe("/wiki/runeworking");
    const article = getWikiArticle("runeworking")!;
    expect(article).toBeDefined();
    const text = JSON.stringify(article);
    // Every shipped recipe, its level, its minimum and where it is made: derived, not restated.
    expect(text).toContain("Beginner Echo Seeker");
    expect(text).toContain("Hilltop Workshop");
    expect(text).toContain("Skatboll TP Rune");
    expect(text).toContain("Resonance Site");
    for (const shipped of runeworkingRecipes(balance)) {
      expect(text, shipped.actionId).toContain(`Runeworking ${shipped.minimumLevel}`);
    }
    // The tabs are gone from the station, and from the prose that described them.
    expect(text).not.toMatch(/two modes|Recipes mode|Attune and Recipes|Rune Fragment stays/);
  });
});
