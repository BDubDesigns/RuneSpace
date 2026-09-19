import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import { type RepairTargetId } from "@/game/config/foundations";
import { MISSIONS, type MissionDefinition, type MissionRequirement } from "@/game/content/missions";
import { getRepairTarget } from "@/game/content/repair-targets";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import {
  deriveMissionGuidanceTargets,
  projectMission,
  type MissionObservation,
} from "@/game/domain/missions";
import { repairObservation, type RepairProgressInput } from "./repair-observation";

/**
 * Issue #172 — every Mission that observes a repair target, by construction.
 *
 * These tests iterate the authored Missions rather than naming two of them, so
 * a third `repair_target_complete` Mission added later is covered the moment it
 * exists. That is the point of the correction this file encodes: staged repair
 * progress and guidance are ordinary behavior of the requirement, not something
 * a Mission author has to remember to opt into. A new repair Mission that
 * authors nothing but `kind` and `targetId` must still read correctly at every
 * phase — if it ever regresses to a flat "Repair X" with unconditional
 * guidance, these fail.
 */

const balance = getEffectiveGameBalance();

/** The authoritative display name for an item, exactly as the server resolves it. */
function itemName(itemId: string): string {
  return resolveItemPresentation(itemId, itemId).displayName;
}

type RepairMission = {
  mission: MissionDefinition;
  requirement: Extract<MissionRequirement, { kind: "repair_target_complete" }>;
  targetId: RepairTargetId;
  displayName: string;
  /** Where the repair physically is, so guidance can be checked from both sides. */
  locationId: string;
  recipe: ReturnType<typeof getRepairTargetBalance>;
};

const repairMissions: readonly RepairMission[] = MISSIONS.flatMap((mission) =>
  mission.requirements
    .filter(
      (
        requirement,
      ): requirement is Extract<MissionRequirement, { kind: "repair_target_complete" }> =>
        requirement.kind === "repair_target_complete",
    )
    .map((requirement) => {
      const definition = getRepairTarget(requirement.targetId)!;
      return {
        mission,
        requirement,
        targetId: requirement.targetId,
        displayName: definition.displayName,
        locationId: definition.locationId,
        recipe: getRepairTargetBalance(requirement.targetId, balance),
      };
    }),
);

function observe(
  targetId: RepairTargetId,
  progress: RepairProgressInput,
  carried: Partial<Record<string, number>> = {},
): MissionObservation {
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map(
      Object.entries(carried).filter((entry): entry is [string, number] => entry[1] !== undefined),
    ),
    stackLimits: new Map(),
    // Every material any authored recipe wants, so a recipe naming Power Cells
    // reads with real names rather than with IDs (#209).
    itemNames: new Map(
      repairMissions.flatMap((entry) =>
        entry.recipe.materials.map((material) => [material.itemId, itemName(material.itemId)]),
      ),
    ),
    repairTargets: repairObservation({ [targetId]: progress }),
  };
}

const accepted = () => ({ acceptedAt: new Date("2026-09-13T00:00:00.000Z") });

function project(entry: RepairMission, observation: MissionObservation, at = entry.locationId) {
  return projectMission(entry.mission, accepted(), at, true, observation, true);
}

/** Requirements of a repair Mission are the only ones these tests speak about. */
function repairRequirement(projection: ReturnType<typeof projectMission>, targetId: string) {
  return projection.requirements?.find((entry) => entry.repairTargetId === targetId);
}

it("finds every authored repair Mission", () => {
  // A guard on the table itself: if this drops to zero the suite below would
  // silently prove nothing.
  expect(repairMissions.length).toBeGreaterThanOrEqual(2);
});

describe.each(repairMissions)(
  "$mission.title observes $displayName generically",
  (entry: RepairMission) => {
    // The recipe's own material list, whatever it happens to be (#209): the
    // Cargo Hold wants Refined Ferrite and Slag, the Crew Stop wants only
    // Refined Ferrite, and the Deep Jag brace wants Refined Ferrite and Power
    // Cells. Nothing below names an item.
    const [primary, secondary] = entry.recipe.materials;
    if (!primary) throw new Error(`${entry.displayName} authors no repair materials`);
    const multiMaterial = secondary !== undefined;
    const somePrimary = Math.max(1, primary.quantity - 5);
    const someSecondary = secondary ? Math.max(1, secondary.quantity - 3) : 0;
    /** Partial installation of this recipe's own materials. */
    const partial = {
      [primary.itemId]: somePrimary,
      ...(secondary ? { [secondary.itemId]: someSecondary } : {}),
    };
    /** Everything the recipe wants, fully installed. */
    const installed = Object.fromEntries(
      entry.recipe.materials.map((material) => [material.itemId, material.quantity]),
    );
    /** Forty of every material this recipe wants, plus something it does not. */
    const carryingPlenty = {
      ...Object.fromEntries(entry.recipe.materials.map((material) => [material.itemId, 40])),
      [balance.items.ferriteShale.itemId]: 40,
    };

    it("authors nothing but the target: no phase copy, no guidance flag", () => {
      // The whole correction in one assertion — the requirement carries only
      // its kind, its target, and the job's own name.
      expect(Object.keys(entry.requirement).sort()).toEqual(["kind", "objective", "targetId"]);
    });

    it("reports installed material progress, and never anything else as progress", () => {
      const projection = project(
        entry,
        // Carried and stored material exist; neither may reach the numerator.
        observe(entry.targetId, { materials: partial }, carryingPlenty),
      );
      const requirement = repairRequirement(projection, entry.targetId);
      expect(requirement?.satisfied).toBe(false);

      if (multiMaterial) {
        // Several materials: one legible row each, and no invented total.
        expect(requirement?.progress).toBeUndefined();
        expect(requirement?.materials).toEqual(
          entry.recipe.materials.map((material) => ({
            itemId: material.itemId,
            label: itemName(material.itemId),
            current: partial[material.itemId] ?? 0,
            target: material.quantity,
            carried: 40,
          })),
        );
        expect(requirement?.objective).toBe(`Install repair materials at the ${entry.displayName}`);
      } else {
        expect(requirement?.materials).toBeUndefined();
        expect(requirement?.progress).toEqual({
          current: somePrimary,
          target: primary.quantity,
        });
        expect(requirement?.objective).toBe(
          `Install ${itemName(primary.itemId)} at the ${entry.displayName} — ${somePrimary} / ${primary.quantity}`,
        );
        expect(requirement?.detail).toBe(`Carrying: 40 ${itemName(primary.itemId)}`);
      }
    });

    it("gives no destination while the player carries none of what is missing", () => {
      const empty = project(entry, observe(entry.targetId, { materials: partial }));
      expect(empty.guidance).toBeUndefined();
      expect(deriveMissionGuidanceTargets([empty]).repairTargetIds.has(entry.targetId)).toBe(false);

      // Nor from anywhere else: there is no location to send the player to.
      const away = project(
        entry,
        observe(entry.targetId, { materials: partial }),
        "somewhere_else",
      );
      expect(away.guidance).toBeUndefined();
    });

    it("guides the repair once a still-needed material is actually carried", () => {
      for (const material of entry.recipe.materials) {
        const projection = project(
          entry,
          observe(entry.targetId, { materials: partial }, { [material.itemId]: 1 }),
        );
        expect(projection.guidance).toMatchObject({ repairTargetId: entry.targetId });
      }
    });

    it("ignores material the recipe no longer needs", () => {
      if (!secondary) return;
      // The first material is fully installed and the second is not: a satchel
      // full of the first advances nothing, so it guides nothing.
      const projection = project(
        entry,
        observe(
          entry.targetId,
          { materials: { [primary.itemId]: primary.quantity } },
          { [primary.itemId]: 99 },
        ),
      );
      expect(projection.guidance).toBeUndefined();
    });

    it("turns to Welding once every material is installed, and guides it unconditionally", () => {
      const projection = project(
        entry,
        observe(entry.targetId, { materials: installed, welded: 3 }),
      );
      const requirement = repairRequirement(projection, entry.targetId);
      expect(requirement?.objective).toBe(
        `Weld the ${entry.displayName} — 3 / ${entry.recipe.repairIncrements} welds`,
      );
      expect(requirement?.progress).toEqual({ current: 3, target: entry.recipe.repairIncrements });
      expect(requirement?.materials).toBeUndefined();
      expect(requirement?.detail).toBeUndefined();
      // Carrying nothing no longer matters: there is one place the work happens.
      expect(projection.guidance).toMatchObject({ repairTargetId: entry.targetId });
    });

    it("hands off to its own turn-in NPC when the repair completes", () => {
      // Projected where the Mission is turned in, which is not always where the
      // work was: Brace Yourself is welded at Deep Jag and reported to Tansy
      // back at The Jag (#209).
      const projection = project(
        entry,
        observe(entry.targetId, { complete: true }),
        entry.mission.turnIn.locationId,
      );
      expect(projection.state).toBe("ready_for_completion");
      expect(projection.guidance).toMatchObject({
        npcId: entry.mission.turnIn.npcId,
        turnIn: true,
      });
      expect(projection.guidance?.repairTargetId).toBeUndefined();
      expect(repairRequirement(projection, entry.targetId)?.satisfied).toBe(true);
      expect(repairRequirement(projection, entry.targetId)?.objective).toBe(
        entry.requirement.objective,
      );
    });
  },
);
