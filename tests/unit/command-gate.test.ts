import { describe, expect, it } from "vitest";
import {
  release,
  requestRefresh,
  tryAcquire,
  type GateModel,
} from "@/features/mining/command-gate";

function model(): GateModel {
  return { locked: false, pending: false };
}

describe("command gate", () => {
  it("refuses a second concurrent mutation", () => {
    const gate = model();
    expect(tryAcquire(gate)).toBe(true);
    expect(gate.locked).toBe(true);
    expect(tryAcquire(gate)).toBe(false);
  });

  it("coalesces an automatic refresh that arrives during a mutation", () => {
    const gate = model();
    expect(tryAcquire(gate)).toBe(true);
    expect(requestRefresh(gate)).toBe(false);
    expect(gate.pending).toBe(true);
    expect(release(gate)).toBe(true);
    expect(gate.locked).toBe(false);
    expect(gate.pending).toBe(false);
  });

  it("runs an automatic refresh immediately when the gate is free", () => {
    const gate = model();
    expect(requestRefresh(gate)).toBe(true);
    expect(gate.pending).toBe(false);
    expect(gate.locked).toBe(false);
  });

  it("coalesces multiple refresh requests into a single follow-up", () => {
    const gate = model();
    expect(tryAcquire(gate)).toBe(true);
    expect(requestRefresh(gate)).toBe(false);
    expect(requestRefresh(gate)).toBe(false);
    expect(gate.pending).toBe(true);
    expect(release(gate)).toBe(true);
    expect(gate.pending).toBe(false);
  });

  it("does not request a follow-up refresh when none arrived", () => {
    const gate = model();
    expect(tryAcquire(gate)).toBe(true);
    expect(release(gate)).toBe(false);
    expect(gate.locked).toBe(false);
    expect(gate.pending).toBe(false);
  });
});
