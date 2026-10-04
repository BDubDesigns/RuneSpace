import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { presentedBeats } from "@/features/dialogue/DialoguePlayer";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import {
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
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
import { DIALOGUE_SEQUENCES, getDialogue } from "@/game/content/dialogue";
import { CURLY_MUST_STASH, MISSIONS, type MissionDefinition } from "@/game/content/missions";
import { getNpc, getResidentNpcs } from "@/game/content/npcs";
import { getRepairTarget } from "@/game/content/repair-targets";
import { SITE_STASHES } from "@/game/content/site-stashes";
import { resolveNpcConversation } from "@/game/domain/conversation";
import {
  deriveMissionGuidanceTargets,
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";

/**
 * Issue #292 — Curly and Curly Must-Stash.
 *
 * Content, routing, and presentation rules provable without PostgreSQL or a
 * browser. The exactly-once payments, the Mission-authorized repair commands,
 * and the Welding XP are proven against real PostgreSQL in
 * tests/integration/curly-must-stash.test.ts; the whole commission is played
 * end to end in tests/e2e/curly-must-stash.spec.ts.
 */

const balance = getEffectiveGameBalance();
const mount = getRepairTargetBalance(REPAIR_TARGET_IDS.curlyStashMount, balance);

function observation(
  options: { installed?: boolean; welded?: number; weldingLevel?: number } = {},
): MissionObservation {
  const installed = options.installed ?? false;
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map(),
    stackLimits: new Map(),
    itemNames: new Map([
      [ITEM_IDS.refinedFerrite, "Refined Ferrite"],
      [ITEM_IDS.slag, "Slag"],
    ]),
    skillLevels: new Map([[SKILL_IDS.welding, options.weldingLevel ?? 1]]),
    repairTargets: new Map([
      [
        REPAIR_TARGET_IDS.curlyStashMount,
        {
          complete: installed,
          materials: mount.materials.map((material) => ({
            itemId: material.itemId,
            // Welding only starts once every material is in.
            contributed: installed || (options.welded ?? 0) > 0 ? material.quantity : 0,
            required: material.quantity,
          })),
          welding: {
            completed: installed ? mount.repairIncrements : (options.welded ?? 0),
            required: mount.repairIncrements,
          },
        },
      ],
    ]),
  };
}

const accepted = { acceptedAt: new Date("2026-10-04T00:00:00.000Z") };
const completed = { ...accepted, completedAt: new Date("2026-10-04T01:00:00.000Z") };

function project(
  mission: { acceptedAt?: Date; completedAt?: Date } | undefined,
  options: Parameters<typeof observation>[0] & { prerequisiteCompleted?: boolean } = {},
): MissionProjection {
  return projectMission(
    CURLY_MUST_STASH,
    mission,
    LOCATION_IDS.holoHollow,
    true,
    observation(options),
    options.prerequisiteCompleted ?? true,
  );
}

function curlyEntries(projection: MissionProjection) {
  return resolveNpcConversation(NPC_IDS.curly, [
    {
      missionId: projection.missionId,
      state: projection.state,
      prerequisiteSatisfied: projection.prerequisiteSatisfied,
      stage: projection.stage,
      requirements: projection.requirements,
    },
  ]);
}

const curlySequences = DIALOGUE_SEQUENCES.filter((sequence) => sequence.npcId === NPC_IDS.curly);

describe("Curly is a second contact at HH B&B", () => {
  it("stands in the B&B beside Mara, after her, and nowhere else", () => {
    const bnb = getResidentNpcs({
      locationId: LOCATION_IDS.holoHollow,
      localPlaceId: LOCAL_PLACE_IDS.hhBnb,
    });
    expect(bnb.map((npc) => npc.id)).toEqual([NPC_IDS.maraKells, NPC_IDS.curly]);
    expect(getResidentNpcs({ locationId: LOCATION_IDS.holoHollow }).map((npc) => npc.id)).toEqual(
      [],
    );
    // He never moves: no relocation can take him out of the B&B.
    expect(getNpc(NPC_IDS.curly)?.relocations).toBeUndefined();
  });

  it("has the three approved expressions as committed transparent portraits", () => {
    const art = getNpc(NPC_IDS.curly)?.expressionAssets ?? {};
    expect(Object.keys(art).sort()).toEqual(
      [EXPRESSION_IDS.concerned, EXPRESSION_IDS.neutral, EXPRESSION_IDS.smile].sort(),
    );
    for (const asset of Object.values(art)) {
      const file = `public${asset}`;
      expect(existsSync(file), file).toBe(true);
      const png = readFileSync(file);
      expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
      // One shared canvas for all three, so switching expression never jumps.
      expect(png.readUInt32BE(16)).toBe(1086);
      expect(png.readUInt32BE(20)).toBe(1448);
      // RGBA: colour type 6.
      expect(png[25]).toBe(6);
    }
  });

  it("only ever speaks with his own approved expressions", () => {
    const art = getNpc(NPC_IDS.curly)?.expressionAssets ?? {};
    for (const sequence of curlySequences) {
      for (const beat of sequence.beats) {
        expect(beat.kind, sequence.id).toBe("npc");
        if (beat.kind !== "npc") continue;
        expect(beat.speakerNpcId).toBe(NPC_IDS.curly);
        expect(beat.presentationMode).toBe("local");
        expect(Object.keys(art), sequence.id).toContain(beat.expressionId);
      }
    }
  });
});

describe("Curly's room before and after the mount", () => {
  const before = CONVERSATION_BACKGROUND_IDS.curlyRoomBefore;
  const after = CONVERSATION_BACKGROUND_IDS.curlyRoomAfter;

  it("registers both approved rooms as committed 15:8-tolerant WebP backgrounds", () => {
    for (const id of [before, after]) {
      const background = getConversationBackground(id);
      expect(background?.locationId).toBe(LOCATION_IDS.holoHollow);
      const file = `public${background?.asset}`;
      const webp = readFileSync(file);
      expect(webp.subarray(8, 12).toString("ascii")).toBe("WEBP");
    }
  });

  it("shows the finished room exactly when the mount's repair is complete", () => {
    expect(resolveConversationBackgroundId(before, new Set())).toBe(before);
    expect(resolveConversationBackgroundId(before, new Set([REPAIR_TARGET_IDS.crewStop]))).toBe(
      before,
    );
    expect(
      resolveConversationBackgroundId(before, new Set([REPAIR_TARGET_IDS.curlyStashMount])),
    ).toBe(after);
    // The finished room is simply itself, and nobody else's art changes.
    expect(resolveConversationBackgroundId(after, new Set())).toBe(after);
    for (const id of Object.values(CONVERSATION_BACKGROUND_IDS)) {
      if (id === before) continue;
      expect(
        resolveConversationBackgroundId(id, new Set([REPAIR_TARGET_IDS.curlyStashMount])),
      ).toBe(id);
    }
  });

  it("authors the unfinished room for the offer, acceptance and reminder", () => {
    for (const dialogueId of [
      DIALOGUE_IDS.curlyMustStashOffer,
      DIALOGUE_IDS.curlyMustStashAccepted,
      DIALOGUE_IDS.curlyMustStashRepairReminder,
      DIALOGUE_IDS.curlySeeingTheWorldsTopic,
    ]) {
      const beats = getDialogue(dialogueId)!.beats;
      expect(new Set(beats.map((beat) => beat.backgroundId)), dialogueId).toEqual(
        new Set([before]),
      );
    }
  });

  it("authors the finished room once the mount is installed, before the payout too", () => {
    for (const dialogueId of [
      DIALOGUE_IDS.curlyMustStashTurnIn,
      DIALOGUE_IDS.curlyMustStashCompletion,
      DIALOGUE_IDS.curlyPostCurlyMustStash,
      DIALOGUE_IDS.curlyBackHomeTopic,
    ]) {
      const beats = getDialogue(dialogueId)!.beats;
      expect(new Set(beats.map((beat) => beat.backgroundId)), dialogueId).toEqual(new Set([after]));
    }
  });

  it("presents Seeing the Worlds in the room as it currently is", () => {
    const topic = getDialogue(DIALOGUE_IDS.curlySeeingTheWorldsTopic)!;
    const unfinished = presentedBeats(topic, undefined, undefined, new Set());
    expect(new Set(unfinished.map((beat) => beat.backgroundId))).toEqual(new Set([before]));
    const finished = presentedBeats(
      topic,
      undefined,
      undefined,
      new Set([REPAIR_TARGET_IDS.curlyStashMount]),
    );
    expect(new Set(finished.map((beat) => beat.backgroundId))).toEqual(new Set([after]));
    // Only the background changes; the words and expressions are untouched.
    expect(finished.map((beat) => ({ ...beat, backgroundId: before }))).toEqual(topic.beats);
  });

  it("never uses the present-venue override, so nothing can undo the room state", () => {
    for (const sequence of curlySequences) {
      expect(sequence.presentsAtCurrentVenue, sequence.id).toBeUndefined();
    }
  });
});

describe("the Mission's shape", () => {
  it("passes authored-content validation", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
  });

  it("is gated by Keep the Change and Welding 1, and nothing else", () => {
    expect(CURLY_MUST_STASH.prerequisiteMissionId).toBe(MISSION_IDS.keepTheChange);
    expect(CURLY_MUST_STASH.prerequisiteSkillLevels).toEqual([
      { skillId: SKILL_IDS.welding, level: 1 },
    ]);
  });

  it("is optional: nothing continues into it, and nothing requires it", () => {
    expect(CURLY_MUST_STASH.continuationMissionId).toBeUndefined();
    const others: readonly MissionDefinition[] = MISSIONS.filter(
      (mission) => mission.id !== CURLY_MUST_STASH.id,
    );
    expect(others.some((mission) => mission.continuationMissionId === CURLY_MUST_STASH.id)).toBe(
      false,
    );
    expect(others.some((mission) => mission.prerequisiteMissionId === CURLY_MUST_STASH.id)).toBe(
      false,
    );
  });

  it("is offered and turned in by Curly, with the approved controls and no decline", () => {
    expect(CURLY_MUST_STASH.offers).toEqual([
      {
        npcId: NPC_IDS.curly,
        locationId: LOCATION_IDS.holoHollow,
        dialogueId: DIALOGUE_IDS.curlyMustStashOffer,
        actionLabel: "TAKE THE JOB",
        acceptEffect: { kind: "credits", amount: 150 },
        acceptedContinuation: { dialogueId: DIALOGUE_IDS.curlyMustStashAccepted },
      },
    ]);
    expect(CURLY_MUST_STASH.turnIn).toMatchObject({
      npcId: NPC_IDS.curly,
      locationId: LOCATION_IDS.holoHollow,
      dialogueId: DIALOGUE_IDS.curlyMustStashTurnIn,
      actionLabel: "COLLECT PAYMENT",
    });
    expect(CURLY_MUST_STASH.reward).toEqual({ kind: "credits", amount: 150 });
  });

  it("asks for the mount and nothing else", () => {
    expect(CURLY_MUST_STASH.requirements).toEqual([
      {
        kind: "repair_target_complete",
        targetId: REPAIR_TARGET_IDS.curlyStashMount,
        objective: "Build Curly's stash mount at HH B&B",
      },
    ]);
  });

  it("keeps the approved completion line", () => {
    const [first] = getDialogue(DIALOGUE_IDS.curlyMustStashCompletion)!.beats;
    expect(first?.text).toBe(
      "There you go! Honestly, I feel like I got the better end of this deal.",
    );
  });
});

describe("the mount is The Jag's Tier-1 job, done for Curly", () => {
  it("is revealed by accepting the Mission, inside HH B&B", () => {
    expect(getRepairTarget(REPAIR_TARGET_IDS.curlyStashMount)).toMatchObject({
      locationId: LOCATION_IDS.holoHollow,
      localPlaceId: LOCAL_PLACE_IDS.hhBnb,
      authorization: { kind: "mission", missionId: MISSION_IDS.curlyMustStash },
    });
  });

  it("uses the same materials, sections, time and Welding XP as The Jag's mount", () => {
    const jag = getRepairTargetBalance(REPAIR_TARGET_IDS.siteStashTheJag, balance);
    expect(mount.materials).toEqual(jag.materials);
    expect(mount.materials).toEqual([
      { itemId: ITEM_IDS.refinedFerrite, quantity: 6 },
      { itemId: ITEM_IDS.slag, quantity: 3 },
    ]);
    expect(mount.repairIncrements).toBe(6);
    expect(mount.repairIncrements * balance.welding.xpPerIncrement).toBe(300);
    // 6 sections x 5 ticks x 600 ms = 18 seconds of base work.
    expect((mount.repairIncrements * balance.welding.attemptDurationTicks * 600) / 1_000).toBe(18);
    // Six sections keeps the ordinary Clean Pass opportunity.
    expect(mount.repairIncrements).toBeGreaterThanOrEqual(
      balance.welding.cleanPass.minimumSectionsForOpportunity,
    );
    expect(mount.actionId).not.toBe(jag.actionId);
  });

  it("is never a player stash site", () => {
    expect(SITE_STASHES.some((site) => site.mountTargetId === mount.targetId)).toBe(false);
  });
});

describe("conversation routing through every stage", () => {
  it("offers nothing before Keep the Change or below Welding 1, but Seeing the Worlds is there", () => {
    for (const locked of [
      project(undefined, { prerequisiteCompleted: false }),
      project(undefined, { weldingLevel: 0 }),
    ]) {
      const entries = curlyEntries(locked);
      expect(entries.some((entry) => entry.kind === "mission")).toBe(false);
      expect(entries.map((entry) => entry.dialogueId)).toEqual([
        DIALOGUE_IDS.curlySeeingTheWorldsTopic,
      ]);
    }
  });

  it("offers the job once eligible, with only the acceptance command", () => {
    const available = project(undefined);
    expect(available.guidance?.availableNpcIds).toEqual([NPC_IDS.curly]);
    const [offer, ...topics] = curlyEntries(available);
    expect(offer).toMatchObject({
      kind: "mission",
      role: "offer",
      dialogueId: DIALOGUE_IDS.curlyMustStashOffer,
      action: { kind: "accept_mission", label: "TAKE THE JOB" },
      acceptedContinuation: { dialogueId: DIALOGUE_IDS.curlyMustStashAccepted },
    });
    expect(topics.map((entry) => entry.dialogueId)).toEqual([
      DIALOGUE_IDS.curlySeeingTheWorldsTopic,
    ]);
  });

  it("reminds without a command however far the work has got", () => {
    for (const welded of [0, 3, 5]) {
      const active = project(accepted, { welded });
      expect(active.state).toBe("active");
      const [reminder] = curlyEntries(active);
      expect(reminder).toMatchObject({
        role: "active",
        dialogueId: DIALOGUE_IDS.curlyMustStashRepairReminder,
      });
      expect(reminder && "action" in reminder ? reminder.action : undefined).toBeUndefined();
    }
  });

  it("guides the mount, inside the B&B, while it is being built", () => {
    const active = project(accepted, { welded: 2 });
    const targets = deriveMissionGuidanceTargets([active]);
    expect([...targets.repairTargetIds]).toEqual([REPAIR_TARGET_IDS.curlyStashMount]);
  });

  it("turns to the payment the moment the mount is installed", () => {
    const installed = project(accepted, { installed: true });
    expect(installed.state).toBe("ready_for_completion");
    const [turnIn] = curlyEntries(installed);
    expect(turnIn).toMatchObject({
      role: "turn_in",
      dialogueId: DIALOGUE_IDS.curlyMustStashTurnIn,
      action: { kind: "complete_mission", label: "COLLECT PAYMENT" },
    });
    const targets = deriveMissionGuidanceTargets([installed]);
    expect([...targets.repairTargetIds]).toEqual([]);
    expect([...targets.turnInNpcIds]).toEqual([NPC_IDS.curly]);
  });

  it("settles into the follow-up and unlocks Back Home only once paid", () => {
    expect(
      curlyEntries(project(accepted, { installed: true })).some(
        (entry) => entry.dialogueId === DIALOGUE_IDS.curlyBackHomeTopic,
      ),
    ).toBe(false);
    const done = curlyEntries(project(completed, { installed: true }));
    expect(done.map((entry) => entry.dialogueId)).toEqual([
      DIALOGUE_IDS.curlyPostCurlyMustStash,
      DIALOGUE_IDS.curlySeeingTheWorldsTopic,
      DIALOGUE_IDS.curlyBackHomeTopic,
    ]);
    expect(done.some((entry) => "action" in entry && entry.action)).toBe(false);
  });
});
