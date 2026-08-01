import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import { carriedItemMassGrams } from "@/game/domain/equipment";
import { planExactStackAddition } from "@/game/domain/inventory";
import {
  POWER_CELL_DAILY_ALLOTMENT,
  POWER_ANNEX_REWARD_SOURCE_ID,
  pacificResetDate,
} from "@/game/domain/power-annex";
import { powerAnnexNow } from "@/server/power-annex-clock";

const balance = getEffectiveGameBalance();

describe("Power Annex Pacific reset day", () => {
  it("ignores the disposable file clock outside canonical localhost E2E", () => {
    const previous = {
      ci: process.env.CI,
      canonicalHttp: process.env.RUNESPACE_E2E_CANONICAL_HTTP,
      clockFile: process.env.RUNESPACE_POWER_ANNEX_CLOCK_FILE,
    };
    const fallback = new Date("2026-01-02T08:00:00.000Z");
    try {
      process.env.CI = "false";
      process.env.RUNESPACE_E2E_CANONICAL_HTTP = "true";
      process.env.RUNESPACE_POWER_ANNEX_CLOCK_FILE = "/does/not/exist";
      expect(powerAnnexNow(fallback)).toEqual(fallback);
    } finally {
      if (previous.ci === undefined) delete process.env.CI;
      else process.env.CI = previous.ci;
      if (previous.canonicalHttp === undefined) delete process.env.RUNESPACE_E2E_CANONICAL_HTTP;
      else process.env.RUNESPACE_E2E_CANONICAL_HTTP = previous.canonicalHttp;
      if (previous.clockFile === undefined) delete process.env.RUNESPACE_POWER_ANNEX_CLOCK_FILE;
      else process.env.RUNESPACE_POWER_ANNEX_CLOCK_FILE = previous.clockFile;
    }
  });

  it("changes eligibility at midnight Pacific rather than after 24 hours", () => {
    expect(pacificResetDate(new Date("2026-01-02T07:59:59.999Z"))).toBe("2026-01-01");
    expect(pacificResetDate(new Date("2026-01-02T08:00:00.000Z"))).toBe("2026-01-02");
  });

  it("uses the spring-forward Pacific calendar date", () => {
    expect(pacificResetDate(new Date("2026-03-08T09:59:59.999Z"))).toBe("2026-03-08");
    expect(pacificResetDate(new Date("2026-03-08T10:00:00.000Z"))).toBe("2026-03-08");
  });

  it("uses the fall-back Pacific calendar date", () => {
    expect(pacificResetDate(new Date("2026-11-01T08:59:59.999Z"))).toBe("2026-11-01");
    expect(pacificResetDate(new Date("2026-11-01T09:00:00.000Z"))).toBe("2026-11-01");
  });

  it("keeps the approved source and reward quantity stable", () => {
    expect(POWER_ANNEX_REWARD_SOURCE_ID).toBe("dewhat_emergency_power_annex_allotment");
    expect(POWER_CELL_DAILY_ALLOTMENT).toBe(5);
  });
});

describe("Power Annex all-or-nothing inventory planning", () => {
  it("defines Power Cells as 500 g stacks of five", () => {
    expect(balance.items.powerCell).toMatchObject({
      itemId: ITEM_IDS.powerCell,
      massGrams: 500,
      stackLimit: 5,
    });
    expect(carriedItemMassGrams(ITEM_IDS.powerCell, balance)).toBe(500);
  });

  it("adds five cells into empty inventory using only required stack rows", () => {
    const result = planExactStackAddition(
      [],
      ITEM_IDS.powerCell,
      5,
      balance.items.powerCell.stackLimit,
      8,
      2_500,
      balance.items.powerCell.massGrams,
    );
    expect(result).toEqual({
      ok: true,
      plan: {
        updatedStacks: [],
        createdStacks: [{ itemId: ITEM_IDS.powerCell, quantity: 5 }],
        remainingQuantity: 0,
      },
    });
  });

  it("fills a partial Power Cell stack before creating another", () => {
    const result = planExactStackAddition(
      [{ id: "partial", itemId: ITEM_IDS.powerCell, quantity: 2 }],
      ITEM_IDS.powerCell,
      5,
      balance.items.powerCell.stackLimit,
      8,
      2_500,
      balance.items.powerCell.massGrams,
    );
    expect(result).toEqual({
      ok: true,
      plan: {
        updatedStacks: [{ id: "partial", quantity: 5 }],
        createdStacks: [{ itemId: ITEM_IDS.powerCell, quantity: 2 }],
        remainingQuantity: 0,
      },
    });
  });

  it("refuses the complete reward when slots or mass cannot fit it", () => {
    const noSlots = planExactStackAddition(
      [{ id: "full", itemId: ITEM_IDS.powerCell, quantity: 5 }],
      ITEM_IDS.powerCell,
      5,
      balance.items.powerCell.stackLimit,
      0,
      2_500,
      balance.items.powerCell.massGrams,
    );
    expect(noSlots).toMatchObject({ ok: false, reason: "slots" });

    const noMass = planExactStackAddition(
      [],
      ITEM_IDS.powerCell,
      5,
      balance.items.powerCell.stackLimit,
      8,
      2_499,
      balance.items.powerCell.massGrams,
    );
    expect(noMass).toMatchObject({ ok: false, reason: "mass" });
  });
});
