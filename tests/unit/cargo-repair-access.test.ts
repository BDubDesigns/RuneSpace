import { describe, expect, it } from "vitest";
import { deriveCargoRepairAccess } from "@/server/cargo-repair-access";

const incomplete = {
  refinedFerriteContributed: 0,
  slagContributed: 0,
  weldingProgress: 0,
  completedAt: null,
};

describe("Cargo repair access boundary", () => {
  it("keeps an incomplete repair locked until Hold It Together is accepted", () => {
    expect(deriveCargoRepairAccess(incomplete, false)).toEqual({
      complete: false,
      repairAvailable: false,
    });
  });

  it("unlocks incomplete repair controls from accepted mission state", () => {
    expect(deriveCargoRepairAccess(incomplete, true)).toEqual({
      complete: false,
      repairAvailable: true,
    });
  });

  it("keeps completed Cargo Holds available without mission state", () => {
    expect(deriveCargoRepairAccess({ ...incomplete, completedAt: new Date() }, false)).toEqual({
      complete: true,
      repairAvailable: true,
    });
  });
});
