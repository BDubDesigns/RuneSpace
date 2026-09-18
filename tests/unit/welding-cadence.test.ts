import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  repairTargetBalances,
  weldingActionIds,
  weldingCadenceActionIds,
} from "@/game/config/balance";
import { ACTION_IDS } from "@/game/config/foundations";
import { travelReplaceableActionIds } from "@/game/domain/travel-replacement";

/**
 * Issue #207 — the one list of "ticks like Welding".
 *
 * Three different things weld: an authored repair target, a Practice weld at
 * Wade's bench, and a customer Work Order. They differ in what is being fixed
 * and what it pays; they do not differ in how a section is timed. A Work Order
 * shipped welding with no live timing at all because the generic live-action
 * projection enumerated the first two and not the third, so what these tests
 * guard is not the contents of a list but the impossibility of that omission
 * happening again: the set is checked against the registries that actually
 * decide what welds, not against a literal restated here.
 */

const balance = getEffectiveGameBalance();
const cadence = weldingCadenceActionIds(balance);
const repairActionIds = repairTargetBalances(balance).map((target) => target.actionId);

const PLAY_SOURCE = readFileSync("server/play.ts", "utf8");

/** Helpers `createPlayResolver` may spread a whole list of action IDs from. */
const ID_LIST_HELPERS: Record<string, () => readonly string[]> = {
  weldingActionIds,
  weldingCadenceActionIds,
};

/**
 * The resolver entries `createPlayResolver` registers, one source string each.
 *
 * Read out of `server/play.ts` rather than imported, because importing it pulls
 * in the database module and this is a unit test. The registry is the only
 * authority on what the game can actually resolve, so a new activity is visible
 * here the moment it is registered.
 */
function resolverRegistryEntries(): readonly string[] {
  const opening = PLAY_SOURCE.indexOf("const entries: PlayResolverEntry[] = [");
  const closing = PLAY_SOURCE.indexOf("return composePlayResolvers(entries)");
  expect(opening).toBeGreaterThan(-1);
  expect(closing).toBeGreaterThan(opening);
  return PLAY_SOURCE.slice(opening, closing)
    .split(/\n {4}(?=\{|\.\.\.)/)
    .slice(1);
}

/** The resolver factories one entry wires up, with comments discarded. */
function resolverFactories(entry: string): readonly string[] {
  const code = entry.replace(/\/\/.*$/gm, "");
  return [...code.matchAll(/(create\w*Resolver)\(/g)].map((match) => match[1]!);
}

/** The action IDs one entry registers, whether named singly or spread. */
function registeredActionIds(entry: string): readonly string[] {
  const spread = /\.\.\.(\w+)\(\)/.exec(entry);
  if (spread) {
    const helper = ID_LIST_HELPERS[spread[1]!];
    expect(
      helper,
      `createPlayResolver spreads ${spread[1]}(); teach this test what it returns`,
    ).toBeDefined();
    return helper!();
  }
  const named = /actionId:\s*ACTION_IDS\.(\w+)/.exec(entry);
  expect(named, `a resolver entry registers no recognizable action ID:\n${entry}`).not.toBeNull();
  const actionId: string | undefined = ACTION_IDS[named![1] as keyof typeof ACTION_IDS];
  expect(actionId, `ACTION_IDS has no member "${named![1]}"`).toBeDefined();
  return [actionId!];
}

/**
 * Every action the registered Welding resolvers resolve.
 *
 * "A Welding resolver" is derived from the factory's own name rather than from
 * a list of the three that exist today, so a fourth kind of Welding is caught
 * by this test on the day it is registered rather than on the day a playtest
 * finds its progress bar frozen.
 */
function weldingResolverActionIds(): readonly string[] {
  return resolverRegistryEntries()
    .filter((entry) => resolverFactories(entry).some((factory) => factory.includes("Welding")))
    .flatMap(registeredActionIds);
}

describe("weldingCadenceActionIds is every action that resolves on the Welding section (#207)", () => {
  it("holds every repair target, Practice, and the Work Order — and nothing else", () => {
    expect(new Set(cadence)).toEqual(
      new Set([...repairActionIds, ACTION_IDS.practiceWelding, ACTION_IDS.workOrderWelding]),
    );
    expect(cadence).toHaveLength(repairActionIds.length + 2);
  });

  it("names only real ACTION_IDS values", () => {
    const authored = new Set<string>(Object.values(ACTION_IDS));
    for (const actionId of cadence) expect(authored.has(actionId)).toBe(true);
  });

  it("covers every action a Welding resolver is registered under, and no other", () => {
    // The guard that is hard to forget: a fourth kind of Welding has to be
    // registered to resolve at all, and registering it without listing it here
    // fails immediately — which is exactly the mistake a Work Order made.
    const registered = weldingResolverActionIds();
    expect(registered.length).toBeGreaterThan(0);
    expect(new Set(registered)).toEqual(new Set(cadence));
  });

  it("is what remains of the travel-replaceable work once Mining and Refining are set aside", () => {
    // A second, independent registry — leaving the yard has to interrupt every
    // kind of Welding, and the interrupt path fails closed on an action it does
    // not know. The two lists are maintained separately and must still agree.
    const notWelding = new Set<string>([ACTION_IDS.ferriteShaleMining, ACTION_IDS.refining]);
    const replaceableWelding = travelReplaceableActionIds().filter((id) => !notWelding.has(id));
    expect(new Set(replaceableWelding)).toEqual(new Set(cadence));
  });
});

describe("weldingActionIds keeps its narrower repair-target contract (#172, #207)", () => {
  it("returns exactly the repair-target registry's action IDs", () => {
    expect(weldingActionIds(balance)).toEqual(repairActionIds);
    expect(new Set(weldingActionIds(balance))).toEqual(
      new Set([ACTION_IDS.cargoHoldWelding, ACTION_IDS.crewStopWelding]),
    );
  });

  it("was not broadened into the cadence list: Practice and Work Orders stay out of it", () => {
    // Callers of `weldingActionIds` resolve a repair target from the ID they
    // get back. Practice fixes nothing and a Work Order is not a repair target,
    // so either one appearing here would hand those callers an ID with no
    // target behind it.
    expect(weldingActionIds(balance)).not.toContain(ACTION_IDS.practiceWelding);
    expect(weldingActionIds(balance)).not.toContain(ACTION_IDS.workOrderWelding);
    expect(weldingActionIds(balance).length).toBeLessThan(cadence.length);
  });
});
