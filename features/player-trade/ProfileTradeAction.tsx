"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { usePlayerTrade } from "./PlayerTradeContext";
import { WaitingForTrade } from "./TradeRequestCards";

/**
 * The same-location profile's action row with **Trade** first (#268). Trade
 * sends the request by the character's public name; the server decides
 * whether that character can be asked, and any refusal — moved away,
 * blocked, restricted, too many requests — is shown here as the server
 * worded it. While the request waits, the row shows Waiting + Cancel Request
 * in place of Trade. The profile's other social actions render after it.
 */
export function ProfileTradeAction({
  targetName,
  children,
}: {
  targetName: string;
  children?: ReactNode;
}) {
  const { requestNote, requestTrade, state } = usePlayerTrade();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const waiting = state?.outgoing?.counterpart.name === targetName ? state.outgoing : undefined;

  // Another profile never inherits this one's refusal.
  useEffect(() => {
    setError(undefined);
  }, [targetName]);

  async function trade() {
    setPending(true);
    setError(undefined);
    const refusal = await requestTrade(targetName);
    setPending(false);
    if (refusal) setError(refusal);
  }

  return (
    <>
      <div
        aria-label={`Interact with ${targetName}`}
        className="mt-3 flex flex-wrap gap-2"
        data-profile-social-actions=""
        role="group"
      >
        {waiting ? null : (
          <ActionButton
            className="min-h-9 px-3 py-1 text-xs"
            loading={pending}
            onClick={() => void trade()}
          >
            Trade
          </ActionButton>
        )}
        {children}
      </div>
      {waiting ? (
        <div className="mt-3">
          <WaitingForTrade request={waiting} />
        </div>
      ) : null}
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      {!waiting && !error && requestNote?.name === targetName ? (
        <Feedback tone="muted">{requestNote.text}</Feedback>
      ) : null}
    </>
  );
}
