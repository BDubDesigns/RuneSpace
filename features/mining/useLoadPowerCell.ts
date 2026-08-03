"use client";

import { useCallback, useTransition } from "react";
import { loadPowerCellAction } from "@/server/actions";
import { useMiningPlay } from "./MiningPlayContext";

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
export function useLoadPowerCell(onFeedback: (feedback: LoadPowerCellFeedback) => void) {
  const { acquireCommand, acceptState, busy, releaseCommand, state } = useMiningPlay();
  const [, startTransition] = useTransition();

  const loadPowerCell = useCallback(() => {
    if (!acquireCommand()) return;
    startTransition(async () => {
      try {
        const result = await loadPowerCellAction({ characterId: state.characterId });
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
  }, [acceptState, acquireCommand, onFeedback, releaseCommand, state.characterId]);

  return { busy, loadPowerCell };
}
