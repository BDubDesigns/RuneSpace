import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import { ITEM_IDS, LOCATION_IDS, REPAIR_TARGET_IDS, SKILL_IDS } from "@/game/config/foundations";
import { itemQuantityLabel } from "@/game/content/item-presentation";
import { BRACE_YOURSELF, OUT_OF_THE_WEATHER, WHEEL_BE_RIGHT_BACK } from "@/game/content/missions";
import {
  deriveMissionGuidanceTargets,
  projectMission,
  stillNeededMaterials,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";
import type { MissionDefinition } from "@/game/content/missions";
import { MissionGuidanceStrips } from "@/features/missions/MissionGuidanceStrips";
import { MissionLogPanel } from "@/features/missions/MissionLogPanel";
import type { PlayGameplayState } from "@/server/play";

vi.mock("@/features/play/PlayContext", () => ({
  usePlay: () => ({ openInventory: () => undefined }),
}));

/**
 * The compact Mission strip's "Still needed" line (#322).
 *
 * A generic reading of the projected repair-material rows: `required - installed
 * - carried`, clamped at zero. It changes neither the durable repair projection
 * nor the Mission Log, and it names no Mission and no repair target — Brace
 * Yourself's two materials prove that below.
 */

const balance = getEffectiveGameBalance();
const gear = getRepairTargetBalance(REPAIR_TARGET_IDS.landingGear, balance);
const caveIn = getRepairTargetBalance(REPAIR_TARGET_IDS.deepJagCaveIn, balance);
const crewStop = getRepairTargetBalance(REPAIR_TARGET_IDS.crewStop, balance);
const accepted = { acceptedAt: new Date("2026-10-06T00:00:00.000Z") };

const NAMES = new Map<string, string>([
  [ITEM_IDS.wheelAssembly, "Wheel Assembly"],
  [ITEM_IDS.mountingBracket, "Mounting Bracket"],
  [ITEM_IDS.galvanicWireSpool, "Galvanic Wire Spool"],
  [ITEM_IDS.refinedFerrite, "Refined Ferrite"],
  [ITEM_IDS.powerCell, "Power Cell"],
]);

type Quantities = Record<string, number>;

function observe(
  targetId: string,
  recipe: ReturnType<typeof getRepairTargetBalance>,
  options: { installed?: Quantities; carried?: Quantities; welded?: number } = {},
): MissionObservation {
  const installed = options.installed ?? {};
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map(Object.entries(options.carried ?? {})),
    stackLimits: new Map(),
    itemNames: NAMES,
    skillLevels: new Map([[SKILL_IDS.welding, 1]]),
    repairTargets: new Map([
      [
        targetId,
        {
          complete: false,
          materials: recipe.materials.map((material) => ({
            itemId: material.itemId,
            contributed: installed[material.itemId] ?? 0,
            required: material.quantity,
          })),
          welding: { completed: options.welded ?? 0, required: recipe.repairIncrements },
        },
      ],
    ]),
  };
}

function wheelMission(
  options: { installed?: Quantities; carried?: Quantities; welded?: number } = {},
): MissionProjection {
  return projectMission(
    WHEEL_BE_RIGHT_BACK,
    accepted,
    LOCATION_IDS.ruskRecovery,
    true,
    observe(REPAIR_TARGET_IDS.landingGear, gear, options),
    true,
  );
}

function braceMission(options: { installed?: Quantities; carried?: Quantities } = {}) {
  return projectMission(
    BRACE_YOURSELF as MissionDefinition,
    accepted,
    LOCATION_IDS.theJag,
    true,
    observe(REPAIR_TARGET_IDS.deepJagCaveIn, caveIn, options),
    true,
  );
}

/** Out of the Weather: the Crew Stop repair, whose recipe is one material (#326). */
function crewStopMission(
  options: { installed?: Quantities; carried?: Quantities; welded?: number } = {},
) {
  return projectMission(
    OUT_OF_THE_WEATHER as MissionDefinition,
    accepted,
    LOCATION_IDS.holoHollow,
    true,
    observe(REPAIR_TARGET_IDS.crewStop, crewStop, options),
    true,
  );
}

const needed = (projection: MissionProjection) =>
  stillNeededMaterials(projection).map(
    (material) => [material.itemId, material.remaining] as const,
  );

const ALL_INSTALLED: Quantities = {
  [ITEM_IDS.wheelAssembly]: 2,
  [ITEM_IDS.mountingBracket]: 2,
  [ITEM_IDS.galvanicWireSpool]: 1,
};

describe("which materials are still needed", () => {
  it("lists every required material when nothing is installed or carried", () => {
    expect(needed(wheelMission())).toEqual([
      [ITEM_IDS.wheelAssembly, 2],
      [ITEM_IDS.mountingBracket, 2],
      [ITEM_IDS.galvanicWireSpool, 1],
    ]);
  });

  it("drops a material whose whole requirement is carried", () => {
    expect(needed(wheelMission({ carried: { [ITEM_IDS.wheelAssembly]: 2 } }))).toEqual([
      [ITEM_IDS.mountingBracket, 2],
      [ITEM_IDS.galvanicWireSpool, 1],
    ]);
  });

  it("subtracts installed and carried quantities together", () => {
    // Required 2, installed 1, carrying 0 -> 1 left.
    expect(needed(wheelMission({ installed: { [ITEM_IDS.wheelAssembly]: 1 } }))[0]).toEqual([
      ITEM_IDS.wheelAssembly,
      1,
    ]);
    // Required 2, installed 1, carrying 1 -> covered.
    expect(
      needed(
        wheelMission({
          installed: { [ITEM_IDS.wheelAssembly]: 1 },
          carried: { [ITEM_IDS.wheelAssembly]: 1 },
        }),
      ).map(([itemId]) => itemId),
    ).not.toContain(ITEM_IDS.wheelAssembly);
    // Required 2, carrying 1 -> 1 left.
    expect(needed(wheelMission({ carried: { [ITEM_IDS.mountingBracket]: 1 } }))[1]).toEqual([
      ITEM_IDS.mountingBracket,
      1,
    ]);
  });

  it("never goes negative when more is carried than is needed", () => {
    const rows = needed(
      wheelMission({ carried: { [ITEM_IDS.wheelAssembly]: 2, [ITEM_IDS.mountingBracket]: 5 } }),
    );
    expect(rows).toEqual([[ITEM_IDS.galvanicWireSpool, 1]]);
  });

  it("brings a material back when the carried coverage is gone", () => {
    const covered = wheelMission({ carried: { [ITEM_IDS.wheelAssembly]: 2 } });
    expect(needed(covered).map(([itemId]) => itemId)).not.toContain(ITEM_IDS.wheelAssembly);
    // The same character after trading the wheels away: only the projection changed.
    const traded = wheelMission({ carried: {} });
    expect(needed(traded)[0]).toEqual([ITEM_IDS.wheelAssembly, 2]);
  });

  it("is empty once every material is covered by installed plus carried", () => {
    expect(
      needed(
        wheelMission({
          installed: { [ITEM_IDS.wheelAssembly]: 1 },
          carried: {
            [ITEM_IDS.wheelAssembly]: 1,
            [ITEM_IDS.mountingBracket]: 2,
            [ITEM_IDS.galvanicWireSpool]: 1,
          },
        }),
      ),
    ).toEqual([]);
  });

  it("is empty during Welding, with no shopping list left over", () => {
    const welding = wheelMission({ installed: ALL_INSTALLED, welded: 0 });
    expect(welding.currentObjective).toBe("Weld the Landing Gear — 0 / 12 welds");
    expect(stillNeededMaterials(welding)).toEqual([]);
  });

  it("is generic: it reads any multi-material repair Mission the same way", () => {
    expect(needed(braceMission())).toEqual([
      [ITEM_IDS.refinedFerrite, 25],
      [ITEM_IDS.powerCell, 5],
    ]);
    expect(needed(braceMission({ installed: { [ITEM_IDS.refinedFerrite]: 25 } }))).toEqual([
      [ITEM_IDS.powerCell, 5],
    ]);
  });

  it("does not alter the durable projection: carried is still not installed", () => {
    const carrying = wheelMission({ carried: { [ITEM_IDS.wheelAssembly]: 2 } });
    const requirement = carrying.requirements!.find((entry) => !entry.satisfied)!;
    expect(requirement.materials).toEqual([
      {
        itemId: ITEM_IDS.wheelAssembly,
        label: "Wheel Assembly",
        current: 0,
        target: 2,
        satisfied: false,
        carried: 2,
      },
      {
        itemId: ITEM_IDS.mountingBracket,
        label: "Mounting Bracket",
        current: 0,
        target: 2,
        satisfied: false,
      },
      {
        itemId: ITEM_IDS.galvanicWireSpool,
        label: "Galvanic Wire Spool",
        current: 0,
        target: 1,
        satisfied: false,
      },
    ]);
    expect(carrying.currentObjective).toBe("Install repair materials at the Landing Gear");
  });
});

describe("how counts read", () => {
  it("uses the item's authored singular and plural, and one name where there is no plural", () => {
    expect(itemQuantityLabel(ITEM_IDS.wheelAssembly, 1, "x")).toBe("1 Wheel Assembly");
    expect(itemQuantityLabel(ITEM_IDS.wheelAssembly, 2, "x")).toBe("2 Wheel Assemblies");
    expect(itemQuantityLabel(ITEM_IDS.mountingBracket, 2, "x")).toBe("2 Mounting Brackets");
    expect(itemQuantityLabel(ITEM_IDS.galvanicWireSpool, 1, "x")).toBe("1 Galvanic Wire Spool");
    expect(itemQuantityLabel(ITEM_IDS.powerCell, 5, "x")).toBe("5 Power Cells");
    expect(itemQuantityLabel(ITEM_IDS.refinedFerrite, 25, "x")).toBe("25 Refined Ferrite");
    expect(itemQuantityLabel("unknown_item", 2, "Mystery Part")).toBe("2 Mystery Part");
  });
});

function stateOf(...missions: MissionProjection[]) {
  return { missions, unpinnedMissionIds: [] } as unknown as PlayGameplayState;
}

function strip(...missions: MissionProjection[]) {
  return renderToStaticMarkup(
    React.createElement(MissionGuidanceStrips, { state: stateOf(...missions) }),
  );
}

function neededLine(markup: string) {
  return /<p[^>]*data-mission-strip-needed[^>]*>([^<]*)<\/p>/.exec(markup)?.[1];
}

describe("the compact Mission strip", () => {
  it("shows the full shopping list under the unchanged objective", () => {
    const markup = strip(wheelMission());
    expect(neededLine(markup)).toBe(
      "Still needed: 2 Wheel Assemblies · 2 Mounting Brackets · 1 Galvanic Wire Spool",
    );
    expect(markup).toContain("Install repair materials at the Landing Gear");
    // Subordinate: it follows the objective line.
    expect(markup.indexOf("data-mission-strip-objective")).toBeLessThan(
      markup.indexOf("data-mission-strip-needed"),
    );
  });

  it("prunes covered materials and singularises what is left", () => {
    const markup = strip(
      wheelMission({
        installed: { [ITEM_IDS.wheelAssembly]: 1 },
        carried: { [ITEM_IDS.mountingBracket]: 2 },
      }),
    );
    expect(neededLine(markup)).toBe("Still needed: 1 Wheel Assembly · 1 Galvanic Wire Spool");
  });

  it("omits the line entirely once everything is covered, and during Welding", () => {
    expect(
      neededLine(
        strip(
          wheelMission({
            carried: {
              [ITEM_IDS.wheelAssembly]: 2,
              [ITEM_IDS.mountingBracket]: 2,
              [ITEM_IDS.galvanicWireSpool]: 1,
            },
          }),
        ),
      ),
    ).toBeUndefined();
    const welding = strip(wheelMission({ installed: ALL_INSTALLED }));
    expect(welding).not.toContain("data-mission-strip-needed");
    expect(welding).not.toContain("Still needed");
    expect(welding).toContain("Weld the Landing Gear — 0 / 12 welds");
  });

  it("reads the same way for another repair Mission", () => {
    expect(neededLine(strip(braceMission()))).toBe(
      "Still needed: 25 Refined Ferrite · 5 Power Cells",
    );
  });
});

describe("the expanded Mission Log keeps every authoritative material row", () => {
  it("shows installed progress and carried context for fully covered rows too", () => {
    const projection = wheelMission({
      installed: { [ITEM_IDS.mountingBracket]: 1 },
      carried: { [ITEM_IDS.wheelAssembly]: 2, [ITEM_IDS.mountingBracket]: 1 },
    });
    const markup = renderToStaticMarkup(
      React.createElement(MissionLogPanel, {
        state: stateOf(projection),
        onClose: () => undefined,
        // Docked: an ordinary region, so it renders without a browser portal.
        presentation: "docked",
        triggerRef: { current: null },
      }),
    );
    for (const itemId of [
      ITEM_IDS.wheelAssembly,
      ITEM_IDS.mountingBracket,
      ITEM_IDS.galvanicWireSpool,
    ]) {
      expect(markup).toContain(`data-mission-requirement-material="${itemId}"`);
    }
    // Wheels are fully carried (so absent from the strip's list) but still show as 0 / 2.
    expect(markup).toContain("Wheel Assembly — 0 / 2");
    expect(markup).toContain("Carrying: 2");
    expect(markup).toContain("Mounting Bracket — 1 / 2");
    expect(markup).toContain("Galvanic Wire Spool — 0 / 1");
    // The compact strip's wording never leaks into the log.
    expect(markup).not.toContain("Still needed");
  });
});

describe("repair-target map guidance is unchanged by the strip line", () => {
  it("still points nowhere while nothing useful is carried, even though the strip lists needs", () => {
    const empty = wheelMission();
    expect(stillNeededMaterials(empty).length).toBe(3);
    expect([...deriveMissionGuidanceTargets([empty]).repairTargetIds]).toEqual([]);
    expect(empty.guidance?.repairTargetId).toBeUndefined();
  });

  it("points at the Crash Site as soon as one useful unit is carried, as before", () => {
    const carrying = wheelMission({ carried: { [ITEM_IDS.wheelAssembly]: 1 } });
    expect([...deriveMissionGuidanceTargets([carrying]).repairTargetIds]).toEqual([
      REPAIR_TARGET_IDS.landingGear,
    ]);
    expect(carrying.guidance).toMatchObject({
      repairTargetId: REPAIR_TARGET_IDS.landingGear,
      locationId: LOCATION_IDS.crashSite,
    });
  });

  it("is not made to point anywhere by carried coverage alone being 'enough'", () => {
    // A surplus of one already-complete material is not useful: no guidance.
    const surplus = wheelMission({
      installed: { [ITEM_IDS.wheelAssembly]: 2 },
      carried: { [ITEM_IDS.wheelAssembly]: 3 },
    });
    expect([...deriveMissionGuidanceTargets([surplus]).repairTargetIds]).toEqual([]);
  });
});

describe("the Mission Log offers item sources without touching the Mission (#326)", () => {
  const log = (projection: MissionProjection) =>
    renderToStaticMarkup(
      React.createElement(MissionLogPanel, {
        state: stateOf(projection),
        onClose: () => undefined,
        presentation: "docked",
        triggerRef: { current: null },
      }),
    );
  const triggers = (markup: string) =>
    [...markup.matchAll(/data-item-sources-trigger="([^"]+)"/g)].map((match) => match[1]);

  it("puts a named Sources control on every unmet material row", () => {
    const markup = log(wheelMission());
    expect(triggers(markup).sort()).toEqual(
      [ITEM_IDS.wheelAssembly, ITEM_IDS.mountingBracket, ITEM_IDS.galvanicWireSpool].sort(),
    );
    expect(markup).toContain('aria-label="How to get Wheel Assembly"');
    expect(markup).toContain('aria-label="How to get Galvanic Wire Spool"');
  });

  it("offers none for a material that is fully installed", () => {
    const markup = log(wheelMission({ installed: { [ITEM_IDS.mountingBracket]: 2 } }));
    expect(triggers(markup)).not.toContain(ITEM_IDS.mountingBracket);
    expect(triggers(markup)).toContain(ITEM_IDS.wheelAssembly);
  });

  it("keeps the compact Current Missions strip free of source detail", () => {
    expect(strip(wheelMission())).not.toContain("data-item-sources");
  });

  it("leaves the projection and its guidance exactly as authored", () => {
    const projection = wheelMission({ carried: { [ITEM_IDS.wheelAssembly]: 1 } });
    const before = structuredClone(projection);
    const guidanceBefore = [...deriveMissionGuidanceTargets([projection]).repairTargetIds];
    log(projection);
    expect(projection).toEqual(before);
    expect([...deriveMissionGuidanceTargets([projection]).repairTargetIds]).toEqual(guidanceBefore);
  });
});

describe("a single-material repair offers Sources like every other unmet item (#326)", () => {
  const [material] = crewStop.materials;
  const log = (projection: MissionProjection) =>
    renderToStaticMarkup(
      React.createElement(MissionLogPanel, {
        state: stateOf(projection),
        onClose: () => undefined,
        presentation: "docked",
        triggerRef: { current: null },
      }),
    );
  const triggers = (markup: string) =>
    [...markup.matchAll(/data-item-sources-trigger="([^"]+)"/g)].map((match) => match[1]);
  const requirementOf = (projection: MissionProjection) =>
    projection.requirements!.find((entry) => entry.repairTargetId === REPAIR_TARGET_IDS.crewStop)!;

  it("is a genuine single-material recipe", () => {
    expect(crewStop.materials).toHaveLength(1);
  });

  it("projects the repair's own material and shows one named Sources control", () => {
    const projection = crewStopMission({ installed: { [material!.itemId]: 5 } });
    expect(requirementOf(projection).itemId).toBe(material!.itemId);
    const markup = log(projection);
    expect(triggers(markup)).toEqual([material!.itemId]);
    expect(markup).toContain('aria-label="How to get Refined Ferrite"');
  });

  it("drops the control once the material is installed, with no state of its own", () => {
    const projection = crewStopMission({ installed: { [material!.itemId]: material!.quantity } });
    expect(requirementOf(projection).itemId).toBeUndefined();
    expect(triggers(log(projection))).toEqual([]);
    // Welding and complete repairs offer none either.
    expect(
      triggers(
        log(crewStopMission({ installed: { [material!.itemId]: material!.quantity }, welded: 3 })),
      ),
    ).toEqual([]);
  });

  it("leaves the objective, progress and carried detail exactly as they were", () => {
    const projection = crewStopMission({
      installed: { [material!.itemId]: 5 },
      carried: { [material!.itemId]: 7 },
    });
    const requirement = requirementOf(projection);
    expect(requirement.progress).toEqual({ current: 5, target: material!.quantity });
    expect(requirement.detail).toBe("Carrying: 7 Refined Ferrite");
    expect(requirement.objective).toBe(
      `Install Refined Ferrite at the Crew Stop — 5 / ${material!.quantity}`,
    );
    expect(requirement.materials).toBeUndefined();
    // The log still renders the same objective and detail text, plus the control.
    const markup = log(projection);
    expect(markup).toContain(
      `Install Refined Ferrite at the Crew Stop — 5 / ${material!.quantity}`,
    );
    expect(markup).toContain("Carrying: 7 Refined Ferrite");
  });

  it("keeps the compact strip and guidance unchanged", () => {
    const projection = crewStopMission({
      installed: { [material!.itemId]: 5 },
      carried: { [material!.itemId]: 7 },
    });
    const markup = strip(projection);
    expect(markup).not.toContain("data-item-sources");
    // One material states itself on the objective: no shopping-list line.
    expect(markup).not.toContain("data-mission-strip-needed");
    expect(stillNeededMaterials(projection)).toEqual([]);
    // Carrying something useful still points at the repair, exactly as before.
    expect([...deriveMissionGuidanceTargets([projection]).repairTargetIds]).toEqual([
      REPAIR_TARGET_IDS.crewStop,
    ]);
  });

  it("leaves a multi-material repair's rows and controls as they were", () => {
    const projection = wheelMission();
    const requirement = projection.requirements!.find((entry) => entry.materials)!;
    expect(requirement.itemId).toBeUndefined();
    expect(requirement.materials).toHaveLength(3);
    expect(triggers(log(projection)).sort()).toEqual(
      [ITEM_IDS.wheelAssembly, ITEM_IDS.mountingBracket, ITEM_IDS.galvanicWireSpool].sort(),
    );
  });
});
