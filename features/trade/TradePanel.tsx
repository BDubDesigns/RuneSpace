"use client";

import { useState, useTransition } from "react";
import { ItemVisual } from "@/components/items/ItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { usePlay } from "@/features/play/PlayContext";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { getItemDefinition } from "@/game/config/balance";
import {
  maximumPurchasableQuantity,
  merchantPurchasableItemIds,
  merchantSellableItemIds,
  merchantTradeDirections,
  merchantUnitPrice,
  type TradeDirection,
} from "@/game/domain/trade";
import type { MerchantDefinition } from "@/game/schemas/merchants";
import { tradeWithMerchantAction } from "@/server/actions";

const MODES: readonly { id: TradeDirection; label: string }[] = [
  { id: "buy", label: "Buy" },
  { id: "sell", label: "Sell" },
];

/**
 * The reusable merchant Buy/Sell surface.
 *
 * Prices come from the authored merchant catalog and the balance shown is the
 * authoritative projected one, so this surface previews a transaction but never
 * decides it: the server re-quotes and re-validates every commit. Quantity
 * starts at one, the total updates live, and a single Buy or Sell commits —
 * there is deliberately no second confirmation step.
 */
export function TradePanel({
  localPlaceId,
  merchant,
}: {
  /** Absent for a merchant the World Location itself hosts, such as Wade's yard (#190). */
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
  const [requestedMode, setMode] = useState<TradeDirection>("buy");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string>();
  const [messageTone, setMessageTone] = useState<"danger" | "muted">("muted");

  const purchasableItemIds = merchantPurchasableItemIds(merchant);
  const sellableItemIds = merchantSellableItemIds(merchant);
  // A direction the authored price table does not support is not a mode at
  // all: offering it would open an empty surface. Wade only sells Scrap, so
  // his yard is Buy-only, and this stays generic merchant behaviour read from
  // the catalog rather than a per-merchant special case.
  const directions = merchantTradeDirections(merchant);
  const availableModes = MODES.filter((option) => directions.includes(option.id));
  const mode: TradeDirection = availableModes.some((option) => option.id === requestedMode)
    ? requestedMode
    : (availableModes[0]?.id ?? "buy");

  const itemIds = mode === "buy" ? purchasableItemIds : sellableItemIds;
  const quantityFor = (itemId: string) => quantities[itemId] ?? 1;
  const ownedQuantity = (itemId: string) =>
    state.inventory.stacks
      .filter((stack) => stack.itemId === itemId)
      .reduce((total, stack) => total + stack.quantity, 0);

  function setQuantity(itemId: string, quantity: number) {
    setQuantities((current) => ({ ...current, [itemId]: Math.max(1, quantity) }));
  }

  /**
   * The Max preview for a purchase. Capacity comes from the shared inventory
   * planner via the domain helper, so this surface never re-derives stacking,
   * slot, or mass rules of its own.
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

  function commit(itemId: string, quantity: number) {
    enqueueForeground(() => {
      startTransition(async () => {
        try {
          const result = await tradeWithMerchantAction({
            characterId: state.characterId,
            ...(localPlaceId ? { localPlaceId } : {}),
            itemId,
            direction: mode,
            quantity,
          });
          if ("error" in result) {
            setMessage(result.error);
            setMessageTone("danger");
          } else {
            acceptState(result.state);
            if (result.trade.status === "refused") {
              setMessage(result.trade.message);
              setMessageTone("danger");
            } else {
              const name = resolveItemPresentation(itemId, itemId).displayName;
              setMessage(
                result.trade.direction === "buy"
                  ? `Bought ${result.trade.quantity} ${name} for ${result.trade.totalCredits} Credits.`
                  : `Sold ${result.trade.quantity} ${name} for ${result.trade.totalCredits} Credits.`,
              );
              setMessageTone("muted");
              setQuantity(itemId, 1);
            }
          }
        } catch {
          setMessage("Comms interruption. The trade could not be confirmed.");
          setMessageTone("danger");
          requestAutoRefresh();
        } finally {
          releaseCommand();
        }
      });
    });
  }

  return (
    // The Drawer that opens this (features/npc/NpcInteractionPanel, #193)
    // already supplies the raised surface, padding and scrolling, so the
    // counter itself adds no second panel around them.
    <div className="mt-4" data-trade-panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeader level={3}>
          {availableModes.length > 1 ? "Buy and sell" : mode === "buy" ? "Buy" : "Sell"}
        </SectionHeader>
        <p
          className="font-display text-sm font-bold text-[color:var(--rs-accent-primary)]"
          data-trade-credits
        >
          {state.credits} Credits
        </p>
      </div>

      {availableModes.length > 1 ? (
        <div className="mt-4 flex gap-2" role="group" aria-label="Trade mode">
          {availableModes.map((option) => (
            <ActionButton
              aria-pressed={mode === option.id}
              data-trade-mode={option.id}
              data-trade-mode-active={mode === option.id ? "true" : "false"}
              intent={mode === option.id ? "primary" : "secondary"}
              key={option.id}
              onClick={() => {
                setMode(option.id);
                // Every transaction starts at one, including after switching mode.
                setQuantities({});
                setMessage(undefined);
              }}
            >
              {option.label}
            </ActionButton>
          ))}
        </div>
      ) : null}

      <ul className="mt-4 space-y-3">
        {itemIds.map((itemId) => {
          const unitPrice = merchantUnitPrice(merchant, itemId, mode);
          if (unitPrice === undefined) return null;
          const presentation = resolveItemPresentation(itemId, itemId);
          const owned = ownedQuantity(itemId);
          const quantity = quantityFor(itemId);
          const total = unitPrice * quantity;
          // A daily-limited line (#230) shows today's allowance from the
          // authoritative projection; it only matters when buying, because
          // selling back never restores it.
          const allowance =
            mode === "buy" ? state.merchantDailyPurchases[merchant.id]?.[itemId] : undefined;
          // Buy caps at the largest purchase that is affordable, within today's
          // allowance, and actually carryable; Sell caps at the authoritative
          // carried quantity. The server re-plans either way.
          const maximum =
            mode === "buy" ? purchasableMaximum(itemId, unitPrice, allowance?.remaining) : owned;
          const affordable =
            mode === "buy"
              ? total <= state.credits && quantity <= (allowance?.remaining ?? quantity)
              : quantity <= owned;

          return (
            <li
              // Identity gets a 7rem column because that is the width
              // VisualTile is actually built for: its own `min-h-28` floor and
              // `h-20 w-20` artwork only resolve to a square, full-size tile at
              // 7rem. The narrower column this row used before starved the art
              // and left the tile a portrait rectangle (#184). Quantity keeps
              // the remaining space, and at phone width it takes the row's full
              // inner width on its own line rather than wrapping inside the
              // ~222px left over beside the tile.
              className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] p-3"
              data-trade-row={itemId}
              key={itemId}
            >
              <div className="sm:row-span-2 sm:self-center" data-trade-item-visual>
                <ItemVisual
                  accessibleLabel={`${presentation.displayName}, ${unitPrice} Credits each, ${owned} carried`}
                  badge={`x${owned}`}
                  className="w-full"
                  itemId={itemId}
                  name={presentation.displayName}
                  quantity={owned}
                />
              </div>
              <div className="min-w-0">
                <p className="font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
                  {presentation.displayName}
                </p>
                <p className="mt-0.5 text-xs text-[color:var(--rs-text-secondary)]">
                  <span data-trade-unit-price>{unitPrice}</span> Credits each · carried{" "}
                  <span data-trade-owned>{owned}</span>
                </p>
                {allowance ? (
                  <p
                    className={`mt-0.5 text-xs ${
                      allowance.remaining === 0
                        ? "text-[color:var(--rs-text-muted)]"
                        : "text-[color:var(--rs-text-secondary)]"
                    }`}
                    data-trade-daily-allowance
                    data-trade-daily-limit={allowance.limit}
                    data-trade-daily-remaining={allowance.remaining}
                  >
                    {allowance.remaining === 0
                      ? `All ${allowance.limit} sold today · more after midnight Pacific`
                      : `${allowance.remaining} of ${allowance.limit} left today`}
                  </p>
                ) : null}
                {/* The committed number reads with the price it comes from, which
                    also keeps it out of the quantity cluster so that cluster fits
                    one line at 390px. */}
                <p className="mt-0.5 font-display text-xs font-bold text-[color:var(--rs-text-primary)]">
                  Total <span data-trade-total>{total}</span> Credits
                </p>
              </div>
              <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 sm:col-span-1 sm:col-start-2">
                <div className="flex items-center gap-2" data-trade-quantity-controls>
                  <ActionButton
                    aria-label={`Decrease ${presentation.displayName} quantity`}
                    className="px-2.5"
                    disabled={busy || quantity <= 1}
                    intent="secondary"
                    onClick={() => setQuantity(itemId, quantity - 1)}
                  >
                    −
                  </ActionButton>
                  <span
                    aria-live="polite"
                    className="min-w-[2.5rem] text-center font-display text-sm font-bold"
                    data-trade-quantity
                  >
                    {quantity}
                  </span>
                  <ActionButton
                    aria-label={`Increase ${presentation.displayName} quantity`}
                    className="px-2.5"
                    disabled={busy}
                    intent="secondary"
                    onClick={() => setQuantity(itemId, quantity + 1)}
                  >
                    +
                  </ActionButton>
                  <ActionButton
                    aria-label={`Maximum ${presentation.displayName} quantity`}
                    className="px-2.5"
                    data-trade-max
                    disabled={busy || maximum < 1}
                    intent="secondary"
                    onClick={() => setQuantity(itemId, maximum)}
                  >
                    Max
                  </ActionButton>
                </div>
                <ActionButton
                  data-trade-commit={itemId}
                  disabled={busy || !affordable}
                  intent="primary"
                  loading={busy}
                  onClick={() => commit(itemId, quantity)}
                >
                  {mode === "buy" ? "Buy" : "Sell"}
                </ActionButton>
              </div>
            </li>
          );
        })}
      </ul>

      {message ? (
        <div className="mt-4" data-trade-feedback>
          <Feedback tone={messageTone}>{message}</Feedback>
        </div>
      ) : null}
    </div>
  );
}
