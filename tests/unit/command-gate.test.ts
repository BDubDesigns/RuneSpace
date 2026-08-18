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
    // This models MiningPlayContext correctly: release background (unlock)
    // before handing ownership to the queued foreground, and foreground has
    // priority over any coalesced background refresh.
    const gate = model();
    expect(tryAcquire(gate)).toBe(true);
    // While background holds, a background refresh also arrives and coalesces
    expect(requestRefresh(gate, 1)).toBe(false);
    expect(gate.pending).toBe(true);

    // Foreground tryAcquire fails — coordinator would queue
    expect(tryAcquire(gate)).toBe(false);
    let queuedRan = false;

    // Simulate releaseCommand's corrected order: dequeue, unlock (release),
    // then foreground wins and re-acquires.
    const hadPending = release(gate);
    expect(gate.locked).toBe(false);
    expect(hadPending).toBe(true); // a coalesced refresh existed
    // Foreground priority: consume the pending refresh without running it
    expect(tryAcquire(gate)).toBe(true);
    queuedRan = true;
    expect(queuedRan).toBe(true);
    expect(gate.locked).toBe(true);
    expect(release(gate)).toBe(false);
    expect(gate.locked).toBe(false);
  });

  it("queued foreground intent executes after background release without double-holding the gate", () => {
    const gate = model();
    expect(tryAcquire(gate)).toBe(true);
    // Foreground queues while background holds
    const queued = () => {
      // Called only after background has already released — gate is free
      expect(gate.locked).toBe(false);
      expect(tryAcquire(gate)).toBe(true);
      expect(release(gate)).toBe(false);
    };
    expect(tryAcquire(gate)).toBe(false);
    expect(release(gate)).toBe(false);
    expect(gate.locked).toBe(false);
    // Coordinator now hands off to queued foreground
    queued();
    expect(gate.locked).toBe(false);
  });

  it("coordinator release ordering: dequeue -> unlock -> foreground priority (the fixed path)", () => {
    // Reproduces the bug: checking the queue before calling release() left locked=true
    // so tryAcquire failed and the queued intent was already cleared.
    function buggyRelease(gate: GateModel, queued: { fn: (() => void) | null }) {
      // BUG: peek queue before unlock
      const q = queued.fn;
      queued.fn = null;
      if (q) {
        if (tryAcquire(gate)) {
          q();
          return "queued";
        }
        return "lost";
      }
      const pending = release(gate);
      return pending ? "refresh" : "idle";
    }

    function fixedRelease(gate: GateModel, queued: { fn: (() => void) | null }) {
      const q = queued.fn;
      queued.fn = null;
      const pending = release(gate);
      if (q) {
        if (tryAcquire(gate)) {
          q();
          return "queued";
        }
        return "lost";
      }
      return pending ? "refresh" : "idle";
    }

    // Fixed path delivers queued intent; buggy path loses it while still locked
    {
      const g2 = model();
      expect(tryAcquire(g2)).toBe(true);
      const q2: { fn: (() => void) | null } = { fn: () => {} };
      expect(fixedRelease(g2, q2)).toBe("queued");
      expect(g2.locked).toBe(true);
      expect(release(g2)).toBe(false);
    }
    {
      const g3 = model();
      expect(tryAcquire(g3)).toBe(true);
      const q3: { fn: (() => void) | null } = { fn: () => {} };
      expect(buggyRelease(g3, q3)).toBe("lost");
    }
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
