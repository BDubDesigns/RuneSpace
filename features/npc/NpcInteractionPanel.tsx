"use client";

import { useRef, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Drawer } from "@/components/ui/Drawer";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { NpcConversation } from "@/features/npc/NpcConversation";
import { TradePanel } from "@/features/trade/TradePanel";
import { getLocationMerchant, getMerchant, isMerchantOpen } from "@/game/content/merchants";
import { getResidentNpc } from "@/game/content/npcs";
import { resolveNpcConversation } from "@/game/domain/conversation";
import { resolveActiveLocalPlace } from "@/game/domain/local-places";
import {
  deriveAcceptedMissionIds,
  deriveCompletedMissionIds,
  deriveMissionGuidanceTargets,
  npcGuidanceMeaning,
} from "@/game/domain/missions";
import { usePlay } from "@/features/play/PlayContext";

/**
 * The resident's Local Contact row: one person, with every interaction they
 * currently offer alongside them.
 *
 * Talk opens the canonical conversation hub. Its conversations come from ONE
 * generic resolver over authoritative mission projections and authored topics,
 * so there are no per-mission ID chains here and a new ordinary mission or
 * topic appears without edits.
 *
 * Trade is a separate action — never a conversation topic and never a command
 * inside the hub. It appears when the active Local Place owns a merchant that
 * this resident fronts, which is read from content rather than from who the
 * resident is, and it opens the merchant's counter in the shared Drawer (#193).
 *
 * The row stands inside the panel for the place the player is in, directly
 * under its description and the place's own population, rather than after the
 * whole surface: on a phone the person in front of you must not sit below the
 * place's activity UI (#190).
 *
 * `localPlaceId` is the Local Place the route requests. It is navigation state,
 * not authoritative position, so it passes through the same validated
 * interpretation the place surface uses before it counts as resident context.
 * Every gameplay command still revalidates its own location server-side.
 */
export function NpcInteractionPanel({
  className = "",
  localPlaceId,
}: {
  /** Spacing supplied by whichever place surface the resident stands in. */
  className?: string;
  localPlaceId?: string;
}) {
  const { foregroundBusy, state } = usePlay();
  const [open, setOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tradeTriggerRef = useRef<HTMLButtonElement>(null);

  const locationId = state.location.currentLocationId;
  const completedMissionIds = deriveCompletedMissionIds(state.missions);
  const activePlace = resolveActiveLocalPlace({
    locationId,
    requestedLocalPlaceId: localPlaceId,
    completedMissionIds,
  });
  // Who is standing here is Mission-derived for an NPC who authored a move
  // (#190); for everybody else it is the same static placement as before.
  const npc = getResidentNpc({ locationId, localPlaceId: activePlace?.id, completedMissionIds });
  // Two venues, one rule: the merchant the open Local Place owns, or — when the
  // player is standing in the World Location itself — the one that location
  // hosts (#190). Either way it is only offered when this resident is the
  // person who fronts it and its authored unlock is satisfied.
  const venueMerchant = activePlace
    ? activePlace.merchantId
      ? getMerchant(activePlace.merchantId)
      : undefined
    : getLocationMerchant(locationId);
  const merchant =
    npc &&
    venueMerchant?.npcId === npc.id &&
    isMerchantOpen(venueMerchant, deriveAcceptedMissionIds(state.missions))
      ? venueMerchant
      : undefined;
  const stationary = !state.activeAction && !state.travelState;
  const entries = npc ? resolveNpcConversation(npc.id, state.missions) : [];
  // Active (green), turn-in (blue), and available (blue) are distinct semantic
  // sets; when one NPC is several targets at once the shared precedence picks
  // the one meaning its Talk control presents.
  const guidanceValue = npc
    ? npcGuidanceMeaning(deriveMissionGuidanceTargets(state.missions), npc.id)
    : undefined;
  if (!npc || (entries.length === 0 && !merchant)) return null;
  // The Talk control reads as a turn-in exactly when one of the currently
  // available conversations drives a completion command right now.
  const turnInAvailable =
    stationary &&
    entries.some((entry) => entry.kind === "mission" && entry.action?.kind === "complete_mission");

  return (
    <div className={className.trim()} data-npc-resident>
      {/* A row, not a card (#193). The person and what they offer is one line
          with the role beneath it, which is ~90px instead of the 163–215px the
          stacked card cost — enough, at 390px, to decide whether the place's
          activity starts above the fold or below it.

          Deliberately not a `Panel`: `rs-bevel`'s clip-path cuts anything
          painted outside the element's box, and a Mission-guided Talk paints a
          12px exterior halo. The old card cleared it on 16px of padding; this
          row is tighter, so it uses a plain bordered surface with nothing to
          clip the glow. Same reason there is no `overflow: hidden` here. */}
      <section
        aria-label={`Local contact: ${npc.displayName}`}
        className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
        data-npc-interaction
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="min-w-0 flex-1 basis-28 font-display text-base font-bold leading-tight">
            {npc.displayName}
          </h2>
          <div className="flex shrink-0 items-center gap-2" data-npc-actions>
            {entries.length > 0 ? (
              <MissionActionButton
                aria-label={`Talk to ${npc.displayName}`}
                data-npc-action="talk"
                data-npc-turn-in={turnInAvailable ? "true" : "false"}
                guidance={guidanceValue}
                haloClassName="w-full"
                ref={triggerRef}
                disabled={foregroundBusy}
                intent={turnInAvailable ? "mission" : "secondary"}
                onClick={() => setOpen(true)}
              >
                Talk
              </MissionActionButton>
            ) : null}
            {merchant ? (
              <ActionButton
                aria-haspopup="dialog"
                aria-label={`Trade with ${npc.displayName}`}
                data-npc-action="trade"
                intent="secondary"
                onClick={() => setTradeOpen(true)}
                ref={tradeTriggerRef}
              >
                Trade
              </ActionButton>
            ) : null}
          </div>
        </div>
        <p className="mt-1.5 text-xs leading-snug text-[color:var(--rs-text-secondary)]">
          {npc.role}
        </p>
        {!stationary ? (
          <Feedback tone="muted">
            Conversations with gameplay actions require a stationary character.
          </Feedback>
        ) : null}
      </section>
      {merchant && tradeOpen ? (
        // Trade is its own surface rather than an inline expansion (#193): the
        // counter is ~390px tall, and unfolding it here pushed the place's own
        // activity that far down the page and put the whole shop between the
        // player and the person they are shopping with. Talk already opens a
        // Drawer; this is the same interaction, so it uses the same one, which
        // also brings the focus trap and the return-to-trigger behaviour that
        // the hand-rolled inline reveal had to approximate.
        <Drawer
          eyebrow="Trade"
          label={`Trade with ${npc.displayName}`}
          onClose={() => setTradeOpen(false)}
          title={npc.displayName}
          triggerRef={tradeTriggerRef}
        >
          <div data-npc-trade>
            <TradePanel
              {...(activePlace ? { localPlaceId: activePlace.id } : {})}
              merchant={merchant}
            />
          </div>
        </Drawer>
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
    </div>
  );
}
