import { describe, expect, it } from "vitest";
import {
  cancelRefresh,
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

  it("cancels a stale scheduler refresh without cancelling a manual refresh", () => {
    const schedulerGate = model();
    expect(tryAcquire(schedulerGate)).toBe(true);
    expect(requestRefresh(schedulerGate, 3)).toBe(false);
    cancelRefresh(schedulerGate, 2);
    expect(schedulerGate.pending).toBe(true);
    cancelRefresh(schedulerGate, 3);
    expect(schedulerGate.pending).toBe(false);
    expect(release(schedulerGate)).toBe(false);

    const manualGate = model();
    expect(tryAcquire(manualGate)).toBe(true);
    expect(requestRefresh(manualGate)).toBe(false);
    cancelRefresh(manualGate, 3);
    expect(manualGate.pending).toBe(true);
    expect(release(manualGate)).toBe(true);
  });
});
