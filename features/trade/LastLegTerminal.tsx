"use client";

import { useId, useState } from "react";
import { ItemVisual } from "@/components/items/ItemVisual";
import { CreditsAmount } from "@/components/ui/CreditsAmount";
import { usePlay } from "@/features/play/PlayContext";
import { useMerchantCounter } from "@/features/trade/useMerchantCounter";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { getLocalPlace, LOCAL_PLACES } from "@/game/content/local-places";
import { getLocation } from "@/game/content/locations";
import { getLocationMerchant, isMerchantOpen } from "@/game/content/merchants";
import { deriveAcceptedMissionIds, deriveCompletedMissionIds } from "@/game/domain/missions";
import {
  merchantPurchasableItemIds,
  merchantSellableItemIds,
  merchantTradeDirections,
  merchantUnitPrice,
  type TradeDirection,
} from "@/game/domain/trade";

/**
 * Last Leg Trading's automated fuel terminal at Stillreach Landing Station (#375).
 *
 * A distinct front end for an existing counter, not a second shop. The merchant
 * is the World Location's own authored merchant, the same Last Leg Trading that
 * Toll fronts at Holo Hollow Landing, so its prices, its Thrust Issues unlock and
 * its per-character daily allowances are the ones the ledger already keys on that
 * merchant's ID: a canister bought here spends the allowance there, and the
 * reverse. Every figure is read from the authoritative projection and every
 * commit is the ordinary `tradeWithMerchantAction` through `useMerchantCounter`,
 * which the server re-quotes and re-validates against the character's real
 * position. This component decides nothing; its job is to look and read like a
 * practical industrial vending machine rather than a person behind a counter.
 *
 * The skin is CSS and inline SVG only (`.rs-terminal` in app/globals.css): a
 * steel bezel, a dim screen, hardware-style keys. No generated illustration.
 * Reduced motion removes the screen's only animation (the status lamp's pulse).
 */
export function LastLegTerminal() {
  const { state } = usePlay();
  const locationId = state.location.currentLocationId;
  const merchant = getLocationMerchant(locationId);
  if (!merchant) return null;
  const open = isMerchantOpen(merchant, {
    acceptedMissionIds: deriveAcceptedMissionIds(state.missions),
    completedMissionIds: deriveCompletedMissionIds(state.missions),
  });
  // The counter that shares this terminal's allowances, named from content.
  const counter = LOCAL_PLACES.find((place) => place.merchantId === merchant.id);
  const counterLocation = counter ? getLocation(counter.parentLocationId) : undefined;
  const sharedWith =
    counter && counterLocation
      ? `${getLocalPlace(counter.id)?.displayName ?? counter.id} at ${counterLocation.displayName}`
      : undefined;

  return (
    <TerminalFrame online={open}>
      {open ? (
        <TerminalCounter merchant={merchant} sharedWith={sharedWith} />
      ) : (
        <div className="rs-terminal__screen" data-terminal-locked>
          <p className="rs-terminal__readout rs-terminal__readout--alert">ACCESS RESTRICTED</p>
          <p className="mt-2 text-sm leading-relaxed text-[color:var(--rs-text-primary)]">
            {merchant.lockedMessage ?? "This terminal is not trading with you yet."}
          </p>
        </div>
      )}
    </TerminalFrame>
  );
}

function TerminalFrame({ online, children }: { online: boolean; children: React.ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rs-terminal"
      data-last-leg-terminal
      data-terminal-state={online ? "online" : "locked"}
    >
      <header className="rs-terminal__header">
        <TerminalMark />
        <div className="min-w-0">
          <h2 className="rs-terminal__brand" id={headingId}>
            Last Leg Trading
          </h2>
          <p className="rs-terminal__model">Automated fuel terminal · Stillreach outlet</p>
        </div>
        <p className="rs-terminal__status" data-terminal-status>
          <span aria-hidden="true" className="rs-terminal__lamp" />
          {online ? "Online" : "Locked"}
        </p>
      </header>
      <div aria-hidden="true" className="rs-terminal__hazard" />
      {children}
    </section>
  );
}

/** The terminal's maker's mark: a canister silhouette in a notched plate. */
function TerminalMark() {
  return (
    <svg aria-hidden="true" className="rs-terminal__mark" viewBox="0 0 40 40">
      <path
        className="rs-terminal__mark-plate"
        d="M6 2h28l4 4v28l-4 4H6l-4-4V6z"
        strokeLinejoin="round"
      />
      <path
        className="rs-terminal__mark-glyph"
        d="M15 9h10v3h2v19a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3V12h2zM17 17h6M17 22h6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const MODES: readonly { id: TradeDirection; label: string }[] = [
  { id: "buy", label: "Buy" },
  { id: "sell", label: "Sell" },
];

function TerminalCounter({
  merchant,
  sharedWith,
}: {
  merchant: NonNullable<ReturnType<typeof getLocationMerchant>>;
  sharedWith: string | undefined;
}) {
  const { state } = usePlay();
  const {
    busy,
    clearFeedback,
    commit,
    credits,
    dailyAllowance,
    feedback,
    ownedQuantity,
    purchasableMaximum,
  } = useMerchantCounter({ merchant });
  const [requestedMode, setMode] = useState<TradeDirection>("buy");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const directions = merchantTradeDirections(merchant);
  const modes = MODES.filter((option) => directions.includes(option.id));
  const mode = modes.some((option) => option.id === requestedMode)
    ? requestedMode
    : (modes[0]?.id ?? "buy");
  const itemIds =
    mode === "buy" ? merchantPurchasableItemIds(merchant) : merchantSellableItemIds(merchant);
  const keysDisabled = busy || Boolean(state.activeAction);
  const quantityFor = (itemId: string) => quantities[itemId] ?? 1;
  const setQuantity = (itemId: string, quantity: number) =>
    setQuantities((current) => ({ ...current, [itemId]: Math.max(1, quantity) }));

  return (
    <div className="rs-terminal__screen" data-terminal-screen>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="rs-terminal__readout">
          Account{" "}
          <span className="rs-terminal__value" data-terminal-credits>
            <CreditsAmount amount={credits} />
          </span>
        </p>
        {modes.length > 1 ? (
          <div aria-label="Terminal mode" className="flex gap-2" role="group">
            {modes.map((option) => (
              <button
                aria-pressed={mode === option.id}
                className="rs-terminal__key"
                data-terminal-mode={option.id}
                key={option.id}
                onClick={() => {
                  setMode(option.id);
                  setQuantities({});
                  clearFeedback();
                }}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <ul className="mt-4 space-y-3">
        {itemIds.map((itemId) => {
          const unitPrice = merchantUnitPrice(merchant, itemId, mode);
          if (unitPrice === undefined) return null;
          const name = resolveItemPresentation(itemId, itemId).displayName;
          const owned = ownedQuantity(itemId);
          const quantity = quantityFor(itemId);
          const total = unitPrice * quantity;
          const allowance = mode === "buy" ? dailyAllowance(itemId) : undefined;
          const maximum =
            mode === "buy" ? purchasableMaximum(itemId, unitPrice, allowance?.remaining) : owned;
          const allowed =
            mode === "buy"
              ? total <= credits && quantity <= (allowance?.remaining ?? quantity)
              : quantity <= owned;
          return (
            <li className="rs-terminal__slot" data-terminal-row={itemId} key={itemId}>
              <div className="rs-terminal__tray">
                <ItemVisual
                  accessibleLabel={`${name}, ${unitPrice} Credits each, ${owned} carried`}
                  badge={`x${owned}`}
                  className="w-full"
                  itemId={itemId}
                  name={name}
                  quantity={owned}
                />
              </div>
              <div className="min-w-0">
                <p className="rs-terminal__item">{name}</p>
                <p className="rs-terminal__line">
                  {mode === "buy" ? "Price" : "Pays"}{" "}
                  <span className="rs-terminal__value" data-terminal-unit-price>
                    {unitPrice} CR
                  </span>{" "}
                  · carried <span data-terminal-owned>{owned}</span>
                </p>
                {allowance ? (
                  <p
                    className="rs-terminal__line"
                    data-terminal-daily-limit={allowance.limit}
                    data-terminal-daily-remaining={allowance.remaining}
                  >
                    {allowance.remaining === 0
                      ? `Daily limit reached (${allowance.limit}) · resets midnight Pacific`
                      : `${allowance.remaining} of ${allowance.limit} left today`}
                  </p>
                ) : null}
                <p className="rs-terminal__line">
                  Total{" "}
                  <span className="rs-terminal__value" data-terminal-total>
                    {total} CR
                  </span>
                </p>
              </div>
              <div className="rs-terminal__controls">
                <div className="flex items-center gap-2">
                  <button
                    aria-label={`Decrease ${name} quantity`}
                    className="rs-terminal__key rs-terminal__key--small"
                    disabled={keysDisabled || quantity <= 1}
                    onClick={() => setQuantity(itemId, quantity - 1)}
                    type="button"
                  >
                    −
                  </button>
                  <span aria-live="polite" className="rs-terminal__qty" data-terminal-quantity>
                    {quantity}
                  </span>
                  <button
                    aria-label={`Increase ${name} quantity`}
                    className="rs-terminal__key rs-terminal__key--small"
                    disabled={keysDisabled}
                    onClick={() => setQuantity(itemId, quantity + 1)}
                    type="button"
                  >
                    +
                  </button>
                  <button
                    aria-label={`Maximum ${name} quantity`}
                    className="rs-terminal__key rs-terminal__key--small"
                    disabled={keysDisabled || maximum < 1}
                    onClick={() => setQuantity(itemId, maximum)}
                    type="button"
                  >
                    Max
                  </button>
                </div>
                <button
                  className="rs-terminal__key rs-terminal__key--commit"
                  data-terminal-commit={itemId}
                  disabled={keysDisabled || !allowed}
                  onClick={() => commit(itemId, mode, quantity, () => setQuantity(itemId, 1))}
                  type="button"
                >
                  {mode === "buy" ? "Dispense" : "Sell"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p
        className={`rs-terminal__feedback ${feedback?.tone === "danger" ? "rs-terminal__feedback--alert" : ""}`}
        data-terminal-feedback={feedback ? feedback.tone : undefined}
        role="status"
      >
        {feedback
          ? feedback.traded
            ? `${feedback.traded.direction === "buy" ? "Dispensed" : "Received"} ${feedback.traded.quantity} × ${resolveItemPresentation(feedback.traded.itemId, feedback.traded.itemId).displayName} · ${feedback.traded.direction === "buy" ? "charged" : "paid"} ${feedback.traded.totalCredits} CR`
            : feedback.text
          : busy
            ? "Processing…"
            : "Ready."}
      </p>
      {sharedWith ? (
        <p className="rs-terminal__fineprint" data-terminal-shared-limits>
          Daily purchase limits are shared with {sharedWith}. Selling back does not restore them.
        </p>
      ) : null}
    </div>
  );
}
