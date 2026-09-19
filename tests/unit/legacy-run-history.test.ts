import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  normalizePersistedMiningAttempts,
  normalizePersistedRefiningAttempts,
} from "@/server/run-history";

/**
 * Issue #211 review — a character who played before #209 must still be able to
 * open the Play terminal.
 *
 * `recent_attempts` on both run-state tables is a bounded display history,
 * written in a shape that predates Mining having sources and Refining having
 * recipes. Nothing rewrites those rows, so the read boundary is what has to
 * cope: a legacy attempt reaching the client without `itemId`, or without
 * `awarded` / `consumed`, crashed the whole terminal for that character rather
 * than degrading one disclosure panel.
 *
 * These tests state the translation exactly, because it is the only thing
 * standing between an upgraded character and operator SQL.
 */

const balance = getEffectiveGameBalance();
const shale = balance.items.ferriteShale.itemId;
const refinedFerrite = balance.items.refinedFerrite.itemId;
const slag = balance.items.slag.itemId;

/** Everything a legacy Mining attempt carried, exactly as `main` wrote it. */
const legacyMiningAttempt = {
  sequence: 3,
  resolvedAt: "2026-09-01T00:00:30.000Z",
  success: true,
  rolledBasisPoints: 1200,
  thresholdBasisPoints: 3500,
  shaleAwarded: 2,
  xpAwarded: 15,
  boosted: true,
  durationTicks: 5,
  chargeConsumed: true,
  remainingCharge: 4,
};

/** Everything a legacy Refining attempt carried, exactly as `main` wrote it. */
const legacyRefiningAttempt = {
  sequence: 7,
  resolvedAt: "2026-09-01T00:01:00.000Z",
  success: false,
  rolledBasisPoints: 8000,
  thresholdBasisPoints: 4000,
  ferriteAwarded: 0,
  slagAwarded: 1,
  shaleConsumed: 2,
  xpAwarded: 3,
  durationTicks: 7,
};

describe("legacy Mining attempt history", () => {
  it("names the only source that existed when the row was written", () => {
    const [normalized] = normalizePersistedMiningAttempts([legacyMiningAttempt], balance);
    expect(normalized).toMatchObject({
      sequence: 3,
      success: true,
      itemId: shale,
      quantityAwarded: 2,
      xpAwarded: 15,
      boosted: true,
      chargeConsumed: true,
      remainingCharge: 4,
    });
    // The field it replaced does not survive into the projection.
    expect(normalized).not.toHaveProperty("shaleAwarded");
  });

  it("leaves an attempt already in the current shape exactly as it is", () => {
    const current = {
      ...legacyMiningAttempt,
      shaleAwarded: undefined,
      itemId: "galvanite",
      quantityAwarded: 1,
    };
    delete (current as Record<string, unknown>).shaleAwarded;
    expect(normalizePersistedMiningAttempts([current], balance)).toEqual([current]);
  });

  it("drops what it cannot read rather than handing the client a crash", () => {
    expect(normalizePersistedMiningAttempts([{ sequence: 1 }, null, "nonsense"], balance)).toEqual(
      [],
    );
    expect(normalizePersistedMiningAttempts(undefined, balance)).toEqual([]);
    expect(normalizePersistedMiningAttempts({ not: "an array" }, balance)).toEqual([]);
  });

  it("keeps the readable attempts in a mixed history", () => {
    const current = { ...legacyMiningAttempt, itemId: "galvanite", quantityAwarded: 1 };
    delete (current as Record<string, unknown>).shaleAwarded;
    const normalized = normalizePersistedMiningAttempts(
      [legacyMiningAttempt, { sequence: 9 }, current],
      balance,
    );
    expect(normalized.map((attempt) => attempt.itemId)).toEqual([shale, "galvanite"]);
  });
});

describe("legacy Refining attempt history", () => {
  it("rebuilds the single Ferrite recipe's own inputs and outputs", () => {
    const [normalized] = normalizePersistedRefiningAttempts([legacyRefiningAttempt], balance);
    expect(normalized).toMatchObject({
      sequence: 7,
      success: false,
      xpAwarded: 3,
      durationTicks: 7,
      consumed: [{ itemId: shale, quantity: 2 }],
      awarded: [{ itemId: slag, quantity: 1 }],
    });
    for (const gone of ["ferriteAwarded", "slagAwarded", "shaleConsumed"]) {
      expect(normalized).not.toHaveProperty(gone);
    }
  });

  it("reads a legacy success as the Refined Ferrite it produced", () => {
    const [normalized] = normalizePersistedRefiningAttempts(
      [
        {
          ...legacyRefiningAttempt,
          success: true,
          ferriteAwarded: 1,
          slagAwarded: 0,
          xpAwarded: 15,
        },
      ],
      balance,
    );
    expect(normalized?.awarded).toEqual([{ itemId: refinedFerrite, quantity: 1 }]);
  });

  it("never writes a zero quantity, so nothing renders '0 Slag'", () => {
    const [normalized] = normalizePersistedRefiningAttempts(
      [{ ...legacyRefiningAttempt, ferriteAwarded: 0, slagAwarded: 0, shaleConsumed: 0 }],
      balance,
    );
    expect(normalized?.awarded).toEqual([]);
    expect(normalized?.consumed).toEqual([]);
  });

  it("leaves an attempt already in the current shape exactly as it is", () => {
    const current = {
      sequence: 2,
      resolvedAt: "2026-09-19T00:00:00.000Z",
      success: false,
      rolledBasisPoints: 9000,
      thresholdBasisPoints: 3500,
      consumed: [
        { itemId: refinedFerrite, quantity: 1 },
        { itemId: "galvanic_stock", quantity: 1 },
      ],
      awarded: [{ itemId: refinedFerrite, quantity: 1 }],
      xpAwarded: 7,
      durationTicks: 12,
    };
    expect(normalizePersistedRefiningAttempts([current], balance)).toEqual([current]);
  });

  it("drops what it cannot read rather than handing the client a crash", () => {
    expect(normalizePersistedRefiningAttempts([{ sequence: 1 }, null, 4], balance)).toEqual([]);
    expect(normalizePersistedRefiningAttempts(undefined, balance)).toEqual([]);
    expect(normalizePersistedRefiningAttempts("[]", balance)).toEqual([]);
  });
});
