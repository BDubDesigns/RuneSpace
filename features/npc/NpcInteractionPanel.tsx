"use client";

import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { NpcConversation } from "@/features/npc/NpcConversation";
import { TradePanel } from "@/features/trade/TradePanel";
import { getMerchant } from "@/game/content/merchants";
import { getResidentNpc } from "@/game/content/npcs";
import { resolveNpcConversation } from "@/game/domain/conversation";
import { resolveActiveLocalPlace } from "@/game/domain/local-places";
import { deriveCompletedMissionIds, deriveMissionGuidanceTargets } from "@/game/domain/missions";
import { usePlay } from "@/features/play/PlayContext";

/**
 * The resident's Local Contact card: one person, with every interaction they
 * currently offer stacked beneath them.
 *
 * Talk opens the canonical conversation hub. Its conversations come from ONE
 * generic resolver over authoritative mission projections and authored topics,
 * so there are no per-mission ID chains here and a new ordinary mission or
 * topic appears without edits.
 *
 * Trade is a separate action — never a conversation topic and never a command
 * inside the hub. It appears when the active Local Place owns a merchant that
 * this resident fronts, which is read from content rather than from who the
 * resident is, and it opens the Trade surface directly beneath this card.
 *
 * `localPlaceId` is the Local Place the route requests. It is navigation state,
 * not authoritative position, so it passes through the same validated
 * interpretation the place surface uses before it counts as resident context.
 * Every gameplay command still revalidates its own location server-side.
 */
export function NpcInteractionPanel({ localPlaceId }: { localPlaceId?: string }) {
  const { foregroundBusy, state } = usePlay();
  const [open, setOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tradeRegionRef = useRef<HTMLElement>(null);
  // Set only when the player opens Trade, so the first render, closing Trade,
  // and authoritative refreshes never scroll the page or move focus.
  const revealTradeRef = useRef(false);

  // Reveal the Trade surface the player just opened, the same way player-opened
  // details are revealed elsewhere: scroll it into view — its scroll margins
  // keep its start clear of the fixed bottom navigation — and move focus into
  // it, yielding to reduced motion.
  useEffect(() => {
    if (!revealTradeRef.current) return;
    revealTradeRef.current = false;
    const region = tradeRegionRef.current;
    if (!tradeOpen || !region) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    region.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    region.focus({ preventScroll: true });
  }, [tradeOpen]);

  const locationId = state.location.currentLocationId;
  const activePlace = resolveActiveLocalPlace({
    locationId,
    requestedLocalPlaceId: localPlaceId,
    completedMissionIds: deriveCompletedMissionIds(state.missions),
  });
  const npc = getResidentNpc({ locationId, localPlaceId: activePlace?.id });
  const placeMerchant = activePlace?.merchantId ? getMerchant(activePlace.merchantId) : undefined;
  const merchant = npc && placeMerchant?.npcId === npc.id ? placeMerchant : undefined;
  const stationary = !state.activeAction && !state.travelState;
  const entries = npc ? resolveNpcConversation(npc.id, state.missions) : [];
  const guidance = deriveMissionGuidanceTargets(state.missions);
  // Available (blue) vs active (green) — distinct semantic sets. If the
  // same NPC is ever in both (e.g. offers a new mission while also being the
  // turn-in for an active one), active green wins.
  const hasActiveGuidance = npc ? guidance.npcIds.has(npc.id) : false;
  const hasAvailableGuidance = npc ? guidance.availableNpcIds.has(npc.id) : false;
  const guidanceClass = hasActiveGuidance
    ? "rs-mission-guidance"
    : hasAvailableGuidance
      ? "rs-mission-available"
      : "";
  const guidanceValue = hasActiveGuidance
    ? "active"
    : hasAvailableGuidance
      ? "available"
      : undefined;
  if (!npc || (entries.length === 0 && !merchant)) return null;
  // The Talk control reads as a turn-in exactly when one of the currently
  // available conversations drives a completion command right now.
  const turnInAvailable =
    stationary &&
    entries.some((entry) => entry.kind === "mission" && entry.action?.kind === "complete_mission");
  const tradeRegionId = activePlace ? `npc-trade-${activePlace.id}` : undefined;

  return (
    <>
      <Panel className="!p-4" data-npc-interaction>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-[11px] uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]">
              Local contact
            </p>
            <h2 className="mt-1 font-display text-lg font-bold">{npc.displayName}</h2>
            <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">{npc.role}</p>
          </div>
          <div className="flex flex-col gap-2 sm:w-44 sm:shrink-0" data-npc-actions>
            {entries.length > 0 ? (
              <ActionButton
                aria-label={`Talk to ${npc.displayName}`}
                className={`w-full ${guidanceClass}`}
                data-npc-action="talk"
                data-npc-turn-in={turnInAvailable ? "true" : "false"}
                data-mission-guidance={guidanceValue}
                ref={triggerRef}
                disabled={foregroundBusy}
                intent={turnInAvailable ? "mission" : "secondary"}
                onClick={() => setOpen(true)}
              >
                Talk
              </ActionButton>
            ) : null}
            {merchant ? (
              <ActionButton
                aria-controls={tradeOpen ? tradeRegionId : undefined}
                aria-expanded={tradeOpen}
                aria-label={
                  tradeOpen
                    ? `Close trade with ${npc.displayName}`
                    : `Trade with ${npc.displayName}`
                }
                className="w-full"
                data-npc-action="trade"
                intent="secondary"
                onClick={() => {
                  revealTradeRef.current = !tradeOpen;
                  setTradeOpen(!tradeOpen);
                }}
              >
                {tradeOpen ? "Close trade" : "Trade"}
              </ActionButton>
            ) : null}
          </div>
        </div>
        {!stationary ? (
          <Feedback tone="muted">
            Conversations with gameplay actions require a stationary character.
          </Feedback>
        ) : null}
      </Panel>
      {merchant && activePlace && tradeOpen ? (
        <section
          aria-label={`Trade with ${npc.displayName}`}
          className="rs-focus scroll-mb-[var(--rs-bottom-nav-clearance)] scroll-mt-3"
          data-npc-trade
          id={tradeRegionId}
          ref={tradeRegionRef}
          tabIndex={-1}
        >
          <TradePanel localPlaceId={activePlace.id} merchant={merchant} />
        </section>
      ) : null}
      {open ? (
        <NpcConversation
          entries={entries}
          npc={npc}
          onClose={() => setOpen(false)}
          stationary={stationary}
          triggerRef={triggerRef}
        />
      ) : null}
    </>
  );
}
