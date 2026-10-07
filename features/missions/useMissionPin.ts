"use client";

import { useRef, useState, useTransition } from "react";
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
 * button that becomes disabled loses keyboard focus. Presses made meanwhile
 * join a per-Mission queue (the latest press for a Mission wins) that the
 * running pass drains, so quickly unpinning several strips drops none of them
 * even though the shared command gate keeps only one queued intent. The
 * command is idempotent, so a repeat asks for the state already requested.
 */
type PinIntent = { pinned: boolean; afterChange?: () => void };

export function useMissionPin() {
  const { acceptState, enqueueForeground, releaseCommand, requestAutoRefresh, state } = usePlay();
  const [, startTransition] = useTransition();
  const [pendingMissionId, setPendingMissionId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const queued = useRef(new Map<string, PinIntent>());

  /** Runs holding the command gate; settles every queued press, in order. */
  function drain() {
    startTransition(async () => {
      try {
        for (let next = first(queued.current); next; next = first(queued.current)) {
          const [missionId, { pinned, afterChange }] = next;
          queued.current.delete(missionId);
          setPendingMissionId(missionId);
          const result = await setMissionPinnedAction({
            characterId: state.characterId,
            missionId,
            pinned,
          });
          if ("error" in result) {
            setMessage(result.error);
            continue;
          }
          if (result.pin.status === "refused") {
            acceptState(result.state);
            setMessage(result.pin.message);
            continue;
          }
          if (afterChange) {
            flushSync(() => acceptState(result.state));
            afterChange();
          } else {
            acceptState(result.state);
          }
        }
      } catch {
        queued.current.clear();
        setMessage("Comms interruption. The Mission Log could not confirm that change.");
        requestAutoRefresh();
      } finally {
        setPendingMissionId(undefined);
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
    queued.current.set(missionId, { pinned, afterChange });
    // A pass already holding the gate picks this up; otherwise this starts one.
    // A pass that finds the queue already drained simply releases the gate.
    enqueueForeground(drain);
  }

  return { message, pendingMissionId, setPinned };
}

function first<K, V>(map: Map<K, V>): [K, V] | undefined {
  return map.entries().next().value;
}
