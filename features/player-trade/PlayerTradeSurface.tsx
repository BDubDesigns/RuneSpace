"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CreditsAmount, CreditsIcon } from "@/components/ui/CreditsAmount";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { usePlay } from "@/features/play/PlayContext";
import { isItemTransferable } from "@/game/domain/player-trade";
import type { TradeExchangeLines, TradeSessionView } from "@/game/schemas/player-trade";
import {
  usePlayerTrade,
  type EndedTradeNotice,
  type TradeCommandError,
  type TradeSessionCommands,
} from "./PlayerTradeContext";
import {
  formatCredits,
  isEmptyOfferLines,
  itemDisplayName,
  itemStateLabel,
  offerableStacks,
  tradeStage,
  type TradeStage,
} from "./trade-presentation";

/**
 * The accepted player trade (#268): a near-full-screen surface over Play
 * while a session is open, then a short result once it ends.
 *
 * Everything shown is the server's: both offers, the version they belong to,
 * each side's Ready and Confirm, and any refused settlement. The player's own
 * controls only ask; nothing moves on screen until the server commits, and
 * after a commit Play re-reads Inventory and Credits. The primary actions sit
 * in a footer that never scrolls away, and the surface cannot be dismissed
 * while the trade is open — Cancel Trade is how a player leaves it.
 */
export function PlayerTradeSurface() {
  const { ended, state } = usePlayerTrade();
  if (state?.session) return <TradeSessionSurface session={state.session} />;
  if (ended) return <TradeEndedSurface ended={ended} />;
  return null;
}

const NAME_CLASS = "[overflow-wrap:anywhere]";

function stageStatus(stage: TradeStage, session: TradeSessionView): string {
  const name = session.counterpart.name;
  switch (stage) {
    case "compose":
      return session.theirs.ready
        ? `${name} is Ready. Choose Ready when you're happy with both offers.`
        : "Build your offer, then choose Ready.";
    case "ready":
      return `You're Ready. Waiting for ${name}…`;
    case "review":
      return session.theirs.confirmed
        ? `${name} has confirmed. Check what you give and receive, then Confirm Trade.`
        : "You're both Ready. Check exactly what you give and receive, then Confirm Trade.";
    case "confirmed":
      return `Confirmed — waiting for ${name}`;
  }
}

function TradeSessionSurface({ session }: { session: TradeSessionView }) {
  const { sessionCommands } = usePlayerTrade();
  // Every command names the version this render shows, never a newer one.
  const commands = sessionCommands(session);
  const stage = tradeStage(session);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const name = session.counterpart.name;

  // A refusal stays until the player acts again or the trade moves on to
  // another stage; a stale-offer refusal must survive the re-read it causes.
  useEffect(() => {
    setError(undefined);
  }, [stage]);

  async function exec(key: string, command: () => Promise<TradeCommandError>) {
    if (pending) return;
    setPending(key);
    setError(undefined);
    const refusal = await command();
    setPending(undefined);
    if (refusal) setError(refusal);
  }

  const frozen = stage === "review" || stage === "confirmed";

  return (
    <Drawer dismissible={false} eyebrow="Player trade" label="Trade" size="full" title="Trade">
      <div
        className="mt-3 flex min-h-0 flex-1 flex-col"
        data-trade-stage={stage}
        data-trade-surface=""
        data-trade-version={session.offerVersion}
      >
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden pb-3">
          <div className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3">
            <p className="text-xs text-[color:var(--rs-text-secondary)]">Trading with</p>
            <p
              className={`font-display text-base font-bold text-[color:var(--rs-text-primary)] ${NAME_CLASS}`}
              data-trade-counterpart=""
            >
              {name}
            </p>
            {session.counterpart.playerName ? (
              <p className={`text-xs text-[color:var(--rs-text-secondary)] ${NAME_CLASS}`}>
                Player: {session.counterpart.playerName}
              </p>
            ) : null}
            <p
              aria-live="polite"
              className="mt-2 text-sm text-[color:var(--rs-text-primary)]"
              data-trade-status=""
            >
              {stageStatus(stage, session)}
            </p>
          </div>
          {session.settlementRefusal && stage === "compose" ? (
            <div data-trade-settlement-refusal={session.settlementRefusal.reason}>
              <Feedback tone="danger">{session.settlementRefusal.message}</Feedback>
            </div>
          ) : null}
          {error ? <Feedback tone="danger">{error}</Feedback> : null}
          {frozen ? (
            <FrozenReview session={session} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <YourOffer
                commands={commands}
                exec={exec}
                pending={pending}
                session={session}
                stage={stage}
              />
              <OfferPanel
                heading="They offer"
                kind="theirs"
                lines={session.theirs}
                status={session.theirs.ready ? "Ready" : "Not ready"}
              />
            </div>
          )}
        </div>
        <footer
          aria-label="Trade actions"
          className="flex flex-wrap gap-2 border-t border-[color:var(--rs-border-structural)] pt-3"
          data-trade-actions=""
        >
          <ActionButton
            className="flex-1 sm:flex-none"
            disabled={pending !== undefined && pending !== "cancel"}
            intent="secondary"
            loading={pending === "cancel"}
            onClick={() => void exec("cancel", commands.cancel)}
          >
            Cancel Trade
          </ActionButton>
          {stage === "compose" ? (
            <ActionButton
              className="flex-1 sm:flex-none"
              disabled={pending !== undefined && pending !== "ready"}
              loading={pending === "ready"}
              onClick={() => void exec("ready", commands.ready)}
            >
              Ready
            </ActionButton>
          ) : null}
          {stage === "ready" || stage === "review" ? (
            <ActionButton
              className="flex-1 sm:flex-none"
              disabled={pending !== undefined && pending !== "change"}
              intent="secondary"
              loading={pending === "change"}
              onClick={() => void exec("change", commands.changeOffer)}
            >
              Change Offer
            </ActionButton>
          ) : null}
          {stage === "review" ? (
            <ActionButton
              className="flex-1 sm:flex-none"
              disabled={pending !== undefined && pending !== "confirm"}
              intent="success"
              loading={pending === "confirm"}
              onClick={() => void exec("confirm", commands.confirm)}
            >
              Confirm Trade
            </ActionButton>
          ) : null}
        </footer>
      </div>
    </Drawer>
  );
}

/** The acting character's own side: editable while composing, locked once Ready. */
function YourOffer({
  session,
  stage,
  pending,
  commands,
  exec,
}: {
  session: TradeSessionView;
  stage: TradeStage;
  pending: string | undefined;
  commands: TradeSessionCommands;
  exec: (key: string, command: () => Promise<TradeCommandError>) => Promise<void>;
}) {
  const { state } = usePlay();
  const editable = stage === "compose";
  const busy = pending !== undefined;
  const offered = session.yours;
  const stacks = offerableStacks(state.inventory.stacks, offered.stacks).filter(
    (stack) => stack.carried > stack.offered,
  );
  const offeredItemIds = new Set(offered.items.map((item) => item.itemInstanceId));
  const uniques = state.inventory.uniqueItems.filter(
    (item) => !offeredItemIds.has(item.id) && isItemTransferable(item.itemId),
  );

  return (
    <OfferPanel
      heading="You offer"
      kind="yours"
      lines={offered}
      locked={!editable}
      onRemoveItem={
        editable
          ? (itemInstanceId) =>
              void exec(`remove-item:${itemInstanceId}`, () => commands.removeItem(itemInstanceId))
          : undefined
      }
      onRemoveStack={
        editable
          ? (itemId, quantity) =>
              void exec(`remove-stack:${itemId}`, () => commands.removeStack(itemId, quantity))
          : undefined
      }
      removeDisabled={busy}
      status={offered.ready ? "Ready — locked" : "Not ready"}
    >
      {editable ? (
        <div className="space-y-3 border-t border-[color:var(--rs-border-subtle)] pt-3">
          <CreditsField
            balance={state.credits}
            busy={busy}
            offered={offered.credits}
            onSet={(credits) => void exec("credits", () => commands.setCredits(credits))}
            pending={pending === "credits"}
          />
          <div className="space-y-2">
            <h4 className="font-display text-xs uppercase tracking-[0.12em] text-[color:var(--rs-text-secondary)]">
              From your Inventory
            </h4>
            {stacks.length === 0 && uniques.length === 0 ? (
              <p className="text-xs text-[color:var(--rs-text-muted)]">
                Nothing left in your Inventory to offer.
              </p>
            ) : (
              <ul className="space-y-2" data-trade-offerable="">
                {stacks.map((stack) => (
                  <StackOfferRow
                    available={stack.carried - stack.offered}
                    busy={busy}
                    itemId={stack.itemId}
                    key={stack.itemId}
                    name={stack.name}
                    onOffer={(quantity) =>
                      void exec(`add-stack:${stack.itemId}`, () =>
                        commands.addStack(stack.itemId, quantity),
                      )
                    }
                    pending={pending === `add-stack:${stack.itemId}`}
                  />
                ))}
                {uniques.map((item) => (
                  <li
                    className="flex min-w-0 flex-wrap items-center justify-between gap-2"
                    data-trade-offerable-item={item.id}
                    key={item.id}
                  >
                    <ItemLabel currentCharge={item.currentCharge} itemId={item.itemId} />
                    <ActionButton
                      aria-label={`Offer ${item.name}`}
                      className="min-h-9 px-3 py-1 text-xs"
                      disabled={busy}
                      intent="secondary"
                      loading={pending === `add-item:${item.id}`}
                      onClick={() =>
                        void exec(`add-item:${item.id}`, () => commands.addItem(item.id))
                      }
                    >
                      Offer
                    </ActionButton>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-[color:var(--rs-text-muted)]">
              Only items carried in your Inventory can be offered. Unequip gear or take it out of
              the Cargo Hold first.
            </p>
          </div>
        </div>
      ) : null}
    </OfferPanel>
  );
}

function CreditsField({
  balance,
  offered,
  busy,
  pending,
  onSet,
}: {
  balance: number;
  offered: number;
  busy: boolean;
  pending: boolean;
  onSet: (credits: number) => void;
}) {
  const [value, setValue] = useState(String(offered));
  const [invalid, setInvalid] = useState(false);
  // Follow the authoritative amount whenever it changes.
  useEffect(() => {
    setValue(String(offered));
    setInvalid(false);
  }, [offered]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const credits = Number(value.trim());
    if (!Number.isSafeInteger(credits) || credits < 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSet(credits);
  }

  return (
    <form className="space-y-1" data-trade-credits="" onSubmit={submit}>
      <label
        className="block text-xs font-semibold text-[color:var(--rs-text-primary)]"
        htmlFor="trade-credits"
      >
        Credits to offer{" "}
        <span className="font-normal">
          (you have <CreditsAmount amount={balance}>{formatCredits(balance)}</CreditsAmount>)
        </span>
      </label>
      <div className="flex gap-2">
        {/* The icon is an adornment: a number input cannot hold one, and the
            label above already names the field and the balance in words. */}
        <div className="relative min-w-0 flex-1 text-sm">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
            <CreditsIcon className="!me-0" />
          </span>
          <input
            aria-invalid={invalid || undefined}
            className="rs-bevel rs-focus min-h-[var(--rs-touch-target)] w-full min-w-0 border bg-[color:var(--rs-surface-control)] pl-[calc(0.75rem+1.3333em+0.5rem)] pr-3 text-sm tabular-nums text-[color:var(--rs-text-primary)] focus:border-[color:var(--rs-accent-primary)]"
            id="trade-credits"
            inputMode="numeric"
            max={balance}
            min={0}
            onChange={(event) => setValue(event.target.value)}
            step={1}
            type="number"
            value={value}
          />
        </div>
        <ActionButton
          className="shrink-0 px-3 text-xs"
          disabled={busy && !pending}
          intent="secondary"
          loading={pending}
          type="submit"
        >
          Set Credits
        </ActionButton>
      </div>
      {invalid ? (
        <p className="text-xs text-[color:var(--rs-accent-danger)]" role="alert">
          Enter a whole number of Credits.
        </p>
      ) : null}
    </form>
  );
}

function StackOfferRow({
  itemId,
  name,
  available,
  busy,
  pending,
  onOffer,
}: {
  itemId: string;
  name: string;
  available: number;
  busy: boolean;
  pending: boolean;
  onOffer: (quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const clamped = Math.min(Math.max(1, quantity), available);
  return (
    <li
      className="flex min-w-0 flex-wrap items-center justify-between gap-2"
      data-trade-offerable-stack={itemId}
    >
      <span className={`min-w-0 flex-1 text-sm text-[color:var(--rs-text-primary)] ${NAME_CLASS}`}>
        {name}
        <span className="block text-xs text-[color:var(--rs-text-secondary)]">
          {available} available
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <input
          aria-label={`Quantity of ${name} to offer`}
          className="rs-bevel rs-focus min-h-9 w-16 border bg-[color:var(--rs-surface-control)] px-2 text-sm tabular-nums text-[color:var(--rs-text-primary)] focus:border-[color:var(--rs-accent-primary)]"
          inputMode="numeric"
          max={available}
          min={1}
          onChange={(event) => setQuantity(Number.parseInt(event.target.value, 10) || 1)}
          step={1}
          type="number"
          value={clamped}
        />
        <ActionButton
          aria-label={`Offer ${clamped} ${name}`}
          className="min-h-9 px-3 py-1 text-xs"
          disabled={busy}
          intent="secondary"
          loading={pending}
          onClick={() => onOffer(clamped)}
        >
          Offer
        </ActionButton>
      </span>
    </li>
  );
}

function ItemLabel({
  itemId,
  currentCharge,
}: {
  itemId: string;
  currentCharge: number | null | undefined;
}) {
  const state = itemStateLabel(itemId, currentCharge);
  return (
    <span className={`min-w-0 flex-1 text-sm text-[color:var(--rs-text-primary)] ${NAME_CLASS}`}>
      {itemDisplayName(itemId)}
      {state ? (
        <span className="block text-xs text-[color:var(--rs-accent-mining)]" data-item-state="">
          {state}
        </span>
      ) : null}
    </span>
  );
}

/** One side's offered Credits, stacks, and unique items, optionally with Remove controls. */
function OfferLinesList({
  lines,
  emptyText,
  onRemoveStack,
  onRemoveItem,
  removeDisabled,
}: {
  lines: TradeExchangeLines;
  emptyText: string;
  onRemoveStack?: (itemId: string, quantity: number) => void;
  onRemoveItem?: (itemInstanceId: string) => void;
  removeDisabled?: boolean;
}) {
  if (isEmptyOfferLines(lines)) {
    return <p className="text-sm text-[color:var(--rs-text-muted)]">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2">
      {lines.credits > 0 ? (
        <li
          className="text-sm font-semibold text-[color:var(--rs-text-primary)]"
          data-offer-credits=""
        >
          <CreditsAmount amount={lines.credits}>{formatCredits(lines.credits)}</CreditsAmount>
        </li>
      ) : null}
      {lines.stacks.map((stack) => (
        <li
          className="flex min-w-0 flex-wrap items-center justify-between gap-2"
          data-offer-stack={stack.itemId}
          key={stack.itemId}
        >
          <span
            className={`min-w-0 flex-1 text-sm text-[color:var(--rs-text-primary)] ${NAME_CLASS}`}
          >
            {itemDisplayName(stack.itemId)} × {stack.quantity}
          </span>
          {onRemoveStack ? (
            <ActionButton
              aria-label={`Remove ${itemDisplayName(stack.itemId)} from your offer`}
              className="min-h-9 px-3 py-1 text-xs"
              disabled={removeDisabled}
              intent="secondary"
              onClick={() => onRemoveStack(stack.itemId, stack.quantity)}
            >
              Remove
            </ActionButton>
          ) : null}
        </li>
      ))}
      {lines.items.map((item) => (
        <li
          className="flex min-w-0 flex-wrap items-center justify-between gap-2"
          data-offer-item={item.itemInstanceId}
          key={item.itemInstanceId}
        >
          <ItemLabel currentCharge={item.currentCharge} itemId={item.itemId} />
          {onRemoveItem ? (
            <ActionButton
              aria-label={`Remove ${itemDisplayName(item.itemId)} from your offer`}
              className="min-h-9 px-3 py-1 text-xs"
              disabled={removeDisabled}
              intent="secondary"
              onClick={() => onRemoveItem(item.itemInstanceId)}
            >
              Remove
            </ActionButton>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function OfferPanel({
  heading,
  kind,
  lines,
  status,
  locked = false,
  onRemoveStack,
  onRemoveItem,
  removeDisabled,
  children,
}: {
  heading: string;
  kind: "yours" | "theirs";
  lines: TradeExchangeLines;
  status: string;
  locked?: boolean;
  onRemoveStack?: (itemId: string, quantity: number) => void;
  onRemoveItem?: (itemInstanceId: string) => void;
  removeDisabled?: boolean;
  children?: ReactNode;
}) {
  const ready = status !== "Not ready";
  return (
    <section
      aria-label={heading}
      className={`min-w-0 space-y-2 border bg-[color:var(--rs-surface-panel)] p-3 ${
        locked
          ? "border-[color:var(--rs-accent-success)] [box-shadow:inset_0_0_0_1px_var(--rs-accent-success)]"
          : "border-[color:var(--rs-border-structural)]"
      }`}
      data-trade-offer={kind}
      data-trade-offer-locked={locked ? "" : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
          {heading}
        </h3>
        <span
          className={`border px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.08em] ${
            ready
              ? "border-[color:var(--rs-accent-success)] text-[color:var(--rs-accent-success)]"
              : "border-[color:var(--rs-border-structural)] text-[color:var(--rs-text-secondary)]"
          }`}
          data-trade-consent=""
        >
          {status}
        </span>
      </div>
      <OfferLinesList
        emptyText={kind === "yours" ? "You aren't offering anything yet." : "Nothing offered yet."}
        lines={lines}
        onRemoveItem={onRemoveItem}
        onRemoveStack={onRemoveStack}
        removeDisabled={removeDisabled}
      />
      {children}
    </section>
  );
}

/** Both Ready: the exact proposal both players are confirming, with no editing. */
function FrozenReview({ session }: { session: TradeSessionView }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-trade-review="">
      <ExchangeColumn
        consent={session.yours.confirmed ? "Confirmed" : "Ready"}
        heading="You Give"
        kind="give"
        lines={session.yours}
      />
      <ExchangeColumn
        consent={session.theirs.confirmed ? `${session.counterpart.name} confirmed` : "Ready"}
        heading="You Receive"
        kind="receive"
        lines={session.theirs}
      />
    </div>
  );
}

function ExchangeColumn({
  heading,
  kind,
  lines,
  consent,
}: {
  heading: string;
  kind: "give" | "receive";
  lines: TradeExchangeLines;
  consent?: string;
}) {
  return (
    <section
      aria-label={heading}
      className="min-w-0 space-y-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
      data-trade-exchange={kind}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
          {heading}
        </h3>
        {consent ? (
          <span
            className={`border border-[color:var(--rs-accent-success)] px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.08em] text-[color:var(--rs-accent-success)] ${NAME_CLASS}`}
          >
            {consent}
          </span>
        ) : null}
      </div>
      <OfferLinesList emptyText="Nothing" lines={lines} />
    </section>
  );
}

const ENDED_COPY: Record<
  EndedTradeNotice["outcome"],
  { title: string; text: (name: string) => string }
> = {
  completed: { title: "Trade complete", text: (name) => `Your trade with ${name} is done.` },
  canceled: {
    title: "Trade canceled",
    text: (name) => `${name} canceled the trade. Nothing moved.`,
  },
  expired: {
    title: "Trade timed out",
    text: (name) => `Your trade with ${name} timed out. Nothing moved.`,
  },
  ended: { title: "Trade ended", text: (name) => `Your trade with ${name} has ended.` },
};

/** How the trade this tab was showing ended; a completed one lists exactly what moved. */
function TradeEndedSurface({ ended }: { ended: EndedTradeNotice }) {
  const { dismissEnded } = usePlayerTrade();
  const copy = ENDED_COPY[ended.outcome];
  return (
    <Drawer
      eyebrow="Player trade"
      label="Trade result"
      onClose={dismissEnded}
      size="full"
      title={copy.title}
    >
      <div className="mt-3 flex min-h-0 flex-1 flex-col" data-trade-ended={ended.outcome}>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden pb-3">
          <div className={NAME_CLASS}>
            <Feedback tone={ended.outcome === "completed" ? "success" : "muted"}>
              {copy.text(ended.counterpartName)}
            </Feedback>
          </div>
          {ended.exchange ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <ExchangeColumn heading="You gave" kind="give" lines={ended.exchange.gave} />
              <ExchangeColumn
                heading="You received"
                kind="receive"
                lines={ended.exchange.received}
              />
            </div>
          ) : null}
        </div>
        <footer className="flex gap-2 border-t border-[color:var(--rs-border-structural)] pt-3">
          <ActionButton className="flex-1 sm:flex-none" onClick={dismissEnded}>
            Done
          </ActionButton>
        </footer>
      </div>
    </Drawer>
  );
}
