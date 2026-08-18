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

  it("foreground intent arriving while background holds gate is not silently dropped when queued at context boundary", () => {
    const gate = model();
    // Background reconciliation acquires the gate
    expect(tryAcquire(gate)).toBe(true);
    expect(gate.locked).toBe(true);

    // Foreground tryAcquire fails while background holds — this is the race
    expect(tryAcquire(gate)).toBe(false);

    // Releasing background must not leave gate permanently locked
    expect(release(gate)).toBe(false);
    expect(gate.locked).toBe(false);

    // Queued foreground can now acquire via the shared gate boundary
    expect(tryAcquire(gate)).toBe(true);
    expect(gate.locked).toBe(true);
    expect(release(gate)).toBe(false);
  });

  it("queued foreground intent executes after background release without flashing", () => {
    // Simulates MiningPlayContext enqueueForeground semantics at gate level:
    // background holds, foreground queues, background releases, queued foreground runs with gate held.
    const gate = model();
    expect(tryAcquire(gate)).toBe(true); // background owns
    let foregroundRan = false;
    const queued = () => {
      expect(gate.locked).toBe(false);
      expect(tryAcquire(gate)).toBe(true);
      foregroundRan = true;
      // foreground holds briefly
      expect(release(gate)).toBe(false);
    };
    // While background holds, tryAcquire would fail — queue instead
    expect(tryAcquire(gate)).toBe(false);
    // Background releases; context would now invoke queued
    expect(release(gate)).toBe(false);
    queued();
    expect(foregroundRan).toBe(true);
    expect(gate.locked).toBe(false);
  });

  it("automatic boundary refresh does not require foreground presentation lock", () => {
    const gate = model();
    expect(tryAcquire(gate)).toBe(true);
    // Background refresh is coalesced, not presented as foreground busy
    expect(requestRefresh(gate, 99)).toBe(false);
    expect(gate.pending).toBe(true);
    expect(gate.pendingToken).toBe(99);
    // Release still coalesces exactly one background refresh
    expect(release(gate)).toBe(true);
  });

  it("does not release a scheduler refresh after a delayed command changes the boundary", () => {
    const gate = model();
    expect(tryAcquire(gate)).toBe(true);
    expect(requestRefresh(gate, 7)).toBe(false);

    // The authoritative response can be accepted before React runs the
    // boundary effect cleanup. Invalidation must happen before release().
    cancelRefresh(gate, 7);
    expect(release(gate)).toBe(false);
    expect(gate.pending).toBe(false);
  });
});
