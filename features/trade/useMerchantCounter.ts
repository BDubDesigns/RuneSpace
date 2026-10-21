"use client";

import { useState, useTransition } from "react";
import { usePlay } from "@/features/play/PlayContext";
import { getItemDefinition } from "@/game/config/balance";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { maximumPurchasableQuantity, type TradeDirection } from "@/game/domain/trade";
import type { MerchantDefinition } from "@/game/schemas/merchants";
import { tradeWithMerchantAction } from "@/server/actions";

export type MerchantCounterFeedback = {
  tone: "danger" | "muted";
  text: string;
  /** Set only for a committed trade, so a front end may restate it in its own voice. */
  traded?: { direction: TradeDirection; itemId: string; quantity: number; totalCredits: number };
};

/**
 * The client side of one merchant's counter, shared by every front end that
 * sells from it: Toll's Trade drawer (`TradePanel`) and Last Leg Trading's
 * automated Stillreach terminal (`LastLegTerminal`, #375) present the same
 * merchant very differently, but read the same authoritative projection and
 * send the same `tradeWithMerchantAction`. Nothing here decides a trade: the
 * server re-quotes, re-validates and charges every commit from authored
 * content, and these figures are previews of what it will allow.
 */
export function useMerchantCounter({
  localPlaceId,
  merchant,
}: {
  /** Absent for a merchant the World Location itself hosts (#190, #375). */
  localPlaceId?: string;
  merchant: MerchantDefinition;
}) {
  const {
    acceptState,
    enqueueForeground,
    foregroundBusy: busy,
    releaseCommand,
    requestAutoRefresh,
    state,
  } = usePlay();
  const [, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<MerchantCounterFeedback>();

  const ownedQuantity = (itemId: string) =>
    state.inventory.stacks
      .filter((stack) => stack.itemId === itemId)
      .reduce((total, stack) => total + stack.quantity, 0);

  /** Today's allowance on a daily-limited line, from the authoritative projection (#230). */
  const dailyAllowance = (itemId: string) => state.merchantDailyPurchases[merchant.id]?.[itemId];

  /**
   * The Max preview for a purchase. Capacity comes from the shared inventory
   * planner via the domain helper, so no front end re-derives stacking, slot,
   * or mass rules of its own.
   */
  function purchasableMaximum(
    itemId: string,
    unitPrice: number,
    dailyRemaining: number | undefined,
  ): number {
    const definition = getItemDefinition(itemId);
    if (!definition || definition.kind !== "stack") return 0;
    return maximumPurchasableQuantity({
      credits: state.credits,
      unitPrice,
      existingStacks: state.inventory.stacks,
      itemId,
      stackLimit: definition.stackLimit,
      availableSlots: state.inventory.slotsAvailable,
      availableWeight: Math.max(0, state.inventory.capacityGrams - state.inventory.massGrams),
      itemWeight: definition.massGrams,
      ...(dailyRemaining === undefined ? {} : { dailyRemaining }),
    });
  }

  function commit(
    itemId: string,
    direction: TradeDirection,
    quantity: number,
    onTraded?: () => void,
  ) {
    enqueueForeground(() => {
      startTransition(async () => {
        try {
          const result = await tradeWithMerchantAction({
            characterId: state.characterId,
            ...(localPlaceId ? { localPlaceId } : {}),
            itemId,
            direction,
            quantity,
          });
          if ("error" in result) {
            setFeedback({ tone: "danger", text: result.error });
          } else {
            acceptState(result.state);
            if (result.trade.status === "refused") {
              setFeedback({ tone: "danger", text: result.trade.message });
            } else {
              const name = resolveItemPresentation(itemId, itemId).displayName;
              const { trade } = result;
              setFeedback({
                tone: "muted",
                text:
                  trade.direction === "buy"
                    ? `Bought ${trade.quantity} ${name} for ${trade.totalCredits} Credits.`
                    : `Sold ${trade.quantity} ${name} for ${trade.totalCredits} Credits.`,
                traded: {
                  direction: trade.direction,
                  itemId: trade.itemId,
                  quantity: trade.quantity,
                  totalCredits: trade.totalCredits,
                },
              });
              onTraded?.();
            }
          }
        } catch {
          setFeedback({
            tone: "danger",
            text: "Comms interruption. The trade could not be confirmed.",
          });
          requestAutoRefresh();
        } finally {
          releaseCommand();
        }
      });
    });
  }

  return {
    busy,
    credits: state.credits,
    dailyAllowance,
    feedback,
    clearFeedback: () => setFeedback(undefined),
    ownedQuantity,
    purchasableMaximum,
    commit,
  };
}
