"use client";

import { useCallback, useTransition } from "react";
import { equipEquipmentAction, unequipEquipmentAction } from "@/server/actions";
import type { EquipmentTarget } from "@/game/domain/equipment";
import { useMiningPlay } from "./MiningPlayContext";

export type EquipFeedback = {
  tone: "muted" | "danger";
  message: string;
};

/**
 * The one narrow client path for submitting equip/unequip commands. Inventory
 * and Equipment both call this hook so command acquisition, uncertain-transport
 * handling, authoritative state acceptance, and refusal mapping stay in exactly
 * one place. The server command remains authoritative; this hook only models
 * submission and the last confirmed state.
 *
 * `onFeedback` is called for refusals and transport errors with a danger tone,
 * and for a successfully accepted equip/unequip with a muted tone carrying the
 * caller-provided success message. Callers decide whether to surface or clear
 * their own status line from that callback.
 */
export function useEquipCommand(onFeedback: (feedback: EquipFeedback) => void) {
  const {
    acceptState,
    enqueueForeground,
    foregroundBusy: busy,
    releaseCommand,
    state,
  } = useMiningPlay();
  const [, startTransition] = useTransition();

  const submit = useCallback(
    (
      action: () => Promise<Awaited<ReturnType<typeof equipEquipmentAction>>>,
      successMessage: string,
    ) => {
      const execute = () => {
        startTransition(async () => {
          try {
            const result = await action();
            if ("error" in result && result.error) {
              onFeedback({ tone: "danger", message: result.error });
              return;
            }
            if (result.state) {
              acceptState(result.state);
              onFeedback({ tone: "muted", message: successMessage });
            }
          } catch {
            onFeedback({
              tone: "danger",
              message: "Comms interruption. Equipment could not be confirmed.",
            });
          } finally {
            releaseCommand();
          }
        });
      };
      enqueueForeground(execute);
    },
    [acceptState, enqueueForeground, onFeedback, releaseCommand, state.characterId],
  );

  const equip = useCallback(
    (itemInstanceId: string, target: EquipmentTarget, successMessage: string) => {
      submit(
        () => equipEquipmentAction({ characterId: state.characterId, itemInstanceId, target }),
        successMessage,
      );
    },
    [state.characterId, submit],
  );

  const unequip = useCallback(
    (target: EquipmentTarget, successMessage: string) => {
      submit(
        () => unequipEquipmentAction({ characterId: state.characterId, target }),
        successMessage,
      );
    },
    [state.characterId, submit],
  );

  return { busy, equip, unequip };
}
