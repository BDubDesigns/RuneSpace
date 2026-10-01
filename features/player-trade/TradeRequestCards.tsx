"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { SafetyFlow } from "@/features/chat/SafetyFlow";
import type {
  IncomingTradeRequestView,
  TradeCounterpart,
  TradeRequestView,
} from "@/game/schemas/player-trade";
import { usePlayerTrade } from "./PlayerTradeContext";

/**
 * The pinned Chat/Social cards for player trade requests (#268). They render
 * inside the Chat/Social surface's actionable region; the trading domain owns
 * their content and wires every action to its authoritative command. A card
 * disappears when the durable request it mirrors does.
 */

const CARD_CLASS =
  "space-y-2 border bg-[color:var(--rs-surface-panel)] p-3 text-sm text-[color:var(--rs-text-primary)]";

function CounterpartIdentity({ counterpart }: { counterpart: TradeCounterpart }) {
  return (
    <span className="min-w-0">
      <span className="break-words font-display font-bold">{counterpart.name}</span>
      {counterpart.playerName ? (
        <span className="block break-words text-xs text-[color:var(--rs-text-secondary)]">
          Player: {counterpart.playerName}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Accept or Decline another character's request. When the sender's account
 * has been sending this player request after request, Decline & Block is made
 * prominent; it runs the ordinary account-level Block flow, then declines.
 */
export function IncomingTradeRequestCard({ request }: { request: IncomingTradeRequestView }) {
  const { acceptRequest, declineRequest } = usePlayerTrade();
  const [pending, setPending] = useState<"accept" | "decline">();
  const [error, setError] = useState<string>();
  const [blocking, setBlocking] = useState(false);
  const name = request.counterpart.name;

  async function respond(kind: "accept" | "decline") {
    setPending(kind);
    setError(undefined);
    const refusal = await (kind === "accept"
      ? acceptRequest(request.id)
      : declineRequest(request.id));
    setPending(undefined);
    if (refusal) setError(refusal);
  }

  return (
    <div
      className={`${CARD_CLASS} ${request.blockProminent ? "border-[color:var(--rs-accent-danger)]" : "border-[color:var(--rs-accent-primary)]"}`}
      data-block-prominent={request.blockProminent ? "" : undefined}
      data-trade-request-card="incoming"
    >
      <p className="font-display text-[10px] uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
        Trade request
      </p>
      <p className="flex flex-col">
        <CounterpartIdentity counterpart={request.counterpart} />
        <span className="text-[color:var(--rs-text-secondary)]">wants to trade with you.</span>
      </p>
      {request.blockProminent ? (
        <p className="text-xs text-[color:var(--rs-text-secondary)]">
          This player keeps sending you trade requests. You can decline and block them — they
          won&apos;t be told.
        </p>
      ) : null}
      {blocking ? (
        <SafetyFlow
          mode="block"
          onDone={(outcome) => {
            setBlocking(false);
            if (!outcome) return;
            if (outcome.tone === "danger") {
              setError(outcome.text);
              return;
            }
            // Blocked: the request is already hidden; declining also releases
            // the requester straight away.
            void declineRequest(request.id);
          }}
          subject={{ name, target: { characterId: request.counterpart.characterId } }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {request.blockProminent ? (
            <ActionButton
              className="min-h-9 px-3 py-1 text-xs"
              disabled={pending !== undefined}
              intent="danger"
              onClick={() => {
                setError(undefined);
                setBlocking(true);
              }}
            >
              Decline &amp; Block
            </ActionButton>
          ) : null}
          <ActionButton
            className="min-h-9 px-3 py-1 text-xs"
            disabled={pending === "decline"}
            loading={pending === "accept"}
            onClick={() => void respond("accept")}
          >
            Accept
          </ActionButton>
          <ActionButton
            className="min-h-9 px-3 py-1 text-xs"
            disabled={pending === "accept"}
            intent="secondary"
            loading={pending === "decline"}
            onClick={() => void respond("decline")}
          >
            Decline
          </ActionButton>
        </div>
      )}
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
    </div>
  );
}

/** The requester's own waiting request: it holds the character idle until answered. */
export function OutgoingTradeRequestCard({ request }: { request: TradeRequestView }) {
  return (
    <div
      className={`${CARD_CLASS} border-[color:var(--rs-border-structural)]`}
      data-trade-request-card="outgoing"
    >
      <WaitingForTrade request={request} />
    </div>
  );
}

/**
 * "Waiting for <character>…" with Cancel Request, shared by the outgoing card
 * and the profile the request was sent from. No countdown: the request simply
 * ends if it is not answered.
 */
export function WaitingForTrade({ request }: { request: TradeRequestView }) {
  const { cancelRequest } = usePlayerTrade();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="space-y-2" data-trade-waiting="">
      <p className="break-words text-sm text-[color:var(--rs-text-primary)]" role="status">
        Waiting for {request.counterpart.name}…
      </p>
      <ActionButton
        className="min-h-9 px-3 py-1 text-xs"
        intent="secondary"
        loading={pending}
        onClick={async () => {
          setPending(true);
          setError(undefined);
          const refusal = await cancelRequest();
          setPending(false);
          if (refusal) setError(refusal);
        }}
      >
        Cancel Request
      </ActionButton>
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
    </div>
  );
}
