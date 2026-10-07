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
 * button that becomes disabled loses keyboard focus. A press made meanwhile
 * queues behind the command gate like any other foreground intent, and the
 * command is idempotent, so a repeat asks for the state already requested.
 */
export function useMissionPin() {
  const { acceptState, enqueueForeground, releaseCommand, requestAutoRefresh, state } = usePlay();
  const [, startTransition] = useTransition();
  const [pendingMissionId, setPendingMissionId] = useState<string>();
  const [message, setMessage] = useState<string>();

  /**
   * `afterChange` runs once the new state has been committed to the DOM, for a
   * caller whose control has just disappeared and needs to move focus.
   */
  function setPinned(missionId: string, pinned: boolean, afterChange?: () => void) {
    setMessage(undefined);
    enqueueForeground(() => {
      setPendingMissionId(missionId);
      startTransition(async () => {
        try {
          const result = await setMissionPinnedAction({
            characterId: state.characterId,
            missionId,
            pinned,
          });
          if ("error" in result) {
            setMessage(result.error);
            return;
          }
          if (result.pin.status === "refused") {
            acceptState(result.state);
            setMessage(result.pin.message);
            return;
          }
          if (afterChange) {
            flushSync(() => acceptState(result.state));
            afterChange();
          } else {
            acceptState(result.state);
          }
        } catch {
          setMessage("Comms interruption. The Mission Log could not confirm that change.");
          requestAutoRefresh();
        } finally {
          setPendingMissionId(undefined);
          releaseCommand();
        }
      });
    });
  }

  return { message, pendingMissionId, setPinned };
}
