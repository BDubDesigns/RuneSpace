"use client";

import { useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { setMissionPinnedAction } from "@/server/actions";
import { usePlay } from "@/features/play/PlayContext";

/**
 * The one client path for Mission pinning (#325), shared by Current Missions'
 * Unpin and the Mission Log's Pin toggle.
 *
 * Not optimistic: the surfaces change only when the authoritative state comes
 * back through `acceptState`, so the strips and the Log can never disagree. A
 * refusal or failure leaves the previous state in place and reports it through
 * `message` for the caller to show.
 *
 * Controls are never disabled while a change is in flight, because a focused
 * button that becomes disabled loses keyboard focus. Presses made meanwhile,
 * from the strips or the Log alike, join one per-Mission queue (the latest
 * press for a Mission wins) that the running pass drains, so no press is lost
 * even though the shared command gate keeps only one queued intent. Each press
 * reports back to the surface that made it. The command is idempotent, so a
 * repeat asks for the state already requested.
 */
type PinIntent = {
  characterId: string;
  pinned: boolean;
  afterChange?: () => void;
  setPending: (missionId: string | undefined) => void;
  report: (message: string) => void;
};

/** Shared by every mounted surface, so their presses never compete for the gate. */
const queued = new Map<string, PinIntent>();

export function useMissionPin() {
  const { acceptState, enqueueForeground, releaseCommand, requestAutoRefresh, state } = usePlay();
  const [, startTransition] = useTransition();
  const [pendingMissionId, setPendingMissionId] = useState<string>();
  const [message, setMessage] = useState<string>();

  /** Runs holding the command gate; settles every queued press, in order. */
  function drain() {
    startTransition(async () => {
      let current: PinIntent | undefined;
      try {
        for (let next = first(queued); next; next = first(queued)) {
          const [missionId, intent] = next;
          queued.delete(missionId);
          current = intent;
          intent.setPending(missionId);
          const result = await setMissionPinnedAction({
            characterId: intent.characterId,
            missionId,
            pinned: intent.pinned,
          });
          intent.setPending(undefined);
          if ("error" in result) {
            intent.report(result.error);
            continue;
          }
          if (result.pin.status === "refused") {
            acceptState(result.state);
            intent.report(result.pin.message);
            continue;
          }
          if (intent.afterChange) {
            flushSync(() => acceptState(result.state));
            intent.afterChange();
          } else {
            acceptState(result.state);
          }
        }
      } catch {
        current?.setPending(undefined);
        const failed = [current, ...queued.values()];
        queued.clear();
        for (const intent of new Set(failed)) {
          intent?.report("Comms interruption. The Mission Log could not confirm that change.");
        }
        requestAutoRefresh();
      } finally {
        releaseCommand();
      }
    });
  }

  /**
   * `afterChange` runs once the new state has been committed to the DOM, for a
   * caller whose control has just disappeared and needs to move focus.
   */
  function setPinned(missionId: string, pinned: boolean, afterChange?: () => void) {
    setMessage(undefined);
    queued.set(missionId, {
      characterId: state.characterId,
      pinned,
      afterChange,
      setPending: setPendingMissionId,
      report: setMessage,
    });
    // A pass already holding the gate picks this up; otherwise this starts one.
    // A pass that finds the queue already drained simply releases the gate.
    enqueueForeground(drain);
  }

  return { message, pendingMissionId, setPinned };
}

function first<K, V>(map: Map<K, V>): [K, V] | undefined {
  return map.entries().next().value;
}
