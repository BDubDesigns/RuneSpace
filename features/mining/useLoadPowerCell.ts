"use client";

import { useCallback, useTransition } from "react";
import { loadPowerCellAction } from "@/server/actions";
import type { LoadPowerCellSelection } from "@/server/mining-commands";
import { usePlay } from "@/features/play/PlayContext";

export type LoadPowerCellFeedback = {
  tone: "muted" | "danger";
  message: string;
};

/**
 * The one narrow client path for submitting the Power Cell load command.
 * Inventory and Equipment both call this hook so command acquisition,
 * uncertain-transport handling, authoritative state acceptance, and status
 * mapping stay in exactly one place. The server command remains authoritative;
 * this hook only models submission and the last confirmed state.
 */
export function useLoadPowerCell(
  onFeedback: (feedback: LoadPowerCellFeedback) => void,
  selectedStack?: LoadPowerCellSelection,
) {
  const {
    acquireCommand,
    acceptState,
    enqueueForeground,
    foregroundBusy: busy,
    releaseCommand,
    state,
  } = usePlay();
  const [, startTransition] = useTransition();

  const loadPowerCell = useCallback(() => {
    const execute = () => {
      startTransition(async () => {
        try {
          const result = await loadPowerCellAction(
            selectedStack
              ? {
                  characterId: state.characterId,
                  stackId: selectedStack.stackId,
                  expectedQuantity: selectedStack.expectedQuantity,
                }
              : { characterId: state.characterId },
          );
          if ("error" in result) {
            onFeedback({ tone: "danger", message: result.error });
            return;
          }
          acceptState(result.state);
          onFeedback(
            result.load.status === "loaded"
              ? {
                  tone: "muted",
                  message: `Power Cell loaded · ${result.load.remainingCharge} boosted attempts ready.`,
                }
              : { tone: "danger", message: result.load.message },
          );
        } catch {
          onFeedback({
            tone: "danger",
            message: "Comms interruption. Power Cell load could not be confirmed.",
          });
        } finally {
          releaseCommand();
        }
      });
    };
    enqueueForeground(execute);
  }, [
    acceptState,
    acquireCommand,
    enqueueForeground,
    onFeedback,
    releaseCommand,
    selectedStack?.expectedQuantity,
    selectedStack?.stackId,
    state.characterId,
  ]);

  return { busy, loadPowerCell };
}
