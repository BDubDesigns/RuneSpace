"use client";

import { useRef, useState, type ReactNode } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Drawer } from "@/components/ui/Drawer";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { NpcConversation } from "@/features/npc/NpcConversation";
import { TradePanel } from "@/features/trade/TradePanel";
import { getLocationMerchant, getMerchant, isMerchantOpen } from "@/game/content/merchants";
import { getResidentNpcs, type NpcDefinition } from "@/game/content/npcs";
import { resolveNpcConversation, type NpcConversationEntry } from "@/game/domain/conversation";
import { resolveActiveLocalPlace } from "@/game/domain/local-places";
import {
  deriveAcceptedMissionIds,
  deriveCompletedMissionIds,
  deriveMissionGuidanceTargets,
  npcGuidanceMeaning,
  type MissionGuidanceMeaning,
} from "@/game/domain/missions";
import type { MerchantDefinition } from "@/game/schemas/merchants";
import { usePlay } from "@/features/play/PlayContext";

/** Everything one resident's Local Contact row presents (#231). */
export type ResidentContact = {
  npc: NpcDefinition;
  entries: readonly NpcConversationEntry[];
  merchant?: MerchantDefinition;
  guidance?: MissionGuidanceMeaning;
  turnInAvailable: boolean;
};

/**
 * The residents of the place the player is in: one Local Contact row per
 * person, each with every interaction that person currently offers.
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
 * The rows stand inside the panel for the place the player is in, directly
 * under its description, rather than after the whole surface: on a phone the
 * people in front of you must not sit below the place's activity UI (#190).
 * Several people can stand in one place (#231); they present in the roster's
 * authored order, so a refresh never reshuffles them, and the place's own
 * population renders once after them rather than once per person.
 *
 * `localPlaceId` is the Local Place the route requests. It is navigation state,
 * not authoritative position, so it passes through the same validated
 * interpretation the place surface uses before it counts as resident context.
 * Every gameplay command still revalidates its own location server-side.
 */
export function NpcInteractionPanel({
  className = "",
  localPlaceId,
  meta,
}: {
  /** Spacing supplied by whichever place surface the residents stand in. */
  className?: string;
  localPlaceId?: string;
  /**
   * Place-level context rendered once with the residents — today, who else is
   * at this location (#193). It rides along here purely to spend one line
   * instead of a row of its own on a phone; it is not about any resident, so
   * whatever is passed states its own subject ("Only you here", not "alone").
   */
  meta?: ReactNode;
}) {
  const { foregroundBusy, state } = usePlay();

  const locationId = state.location.currentLocationId;
  const completedMissionIds = deriveCompletedMissionIds(state.missions);
  const acceptedMissionIds = deriveAcceptedMissionIds(state.missions);
  const activePlace = resolveActiveLocalPlace({
    locationId,
    requestedLocalPlaceId: localPlaceId,
    completedMissionIds,
  });
  // Who is standing here is Mission-derived for an NPC who authored a move
  // (#190, #231); for everybody else it is the same static placement as before.
  const residents = getResidentNpcs({
    locationId,
    localPlaceId: activePlace?.id,
    completedMissionIds,
  });
  // Two venues, one rule: the merchant the open Local Place owns, or — when the
  // player is standing in the World Location itself — the one that location
  // hosts (#190). Either way it is only offered on the row of the resident who
  // fronts it, and only once its authored unlock is satisfied.
  const venueMerchant = activePlace
    ? activePlace.merchantId
      ? getMerchant(activePlace.merchantId)
      : undefined
    : getLocationMerchant(locationId);
  const stationary = !state.activeAction && !state.travelState;
  const guidanceTargets = deriveMissionGuidanceTargets(state.missions);
  const contacts = residents
    .map((npc): ResidentContact => {
      const entries = resolveNpcConversation(npc.id, state.missions, {
        workOrdersRefreshUnlocked: state.workOrders.refresh.unlocked,
      });
      return {
        npc,
        entries,
        ...(venueMerchant?.npcId === npc.id && isMerchantOpen(venueMerchant, acceptedMissionIds)
          ? { merchant: venueMerchant }
          : {}),
        // Active (green), turn-in (blue), and available (blue) are distinct
        // semantic sets; when one NPC is several targets at once the shared
        // precedence picks the one meaning its Talk control presents.
        guidance: npcGuidanceMeaning(guidanceTargets, npc.id),
        // The Talk control reads as a turn-in exactly when one of the currently
        // available conversations drives a completion command right now.
        turnInAvailable:
          stationary &&
          entries.some(
            (entry) => entry.kind === "mission" && entry.action?.kind === "complete_mission",
          ),
      };
    })
    // Somebody with nothing to say and nothing to sell presents no row.
    .filter((contact) => contact.entries.length > 0 || contact.merchant);

  return (
    <ResidentContacts
      className={className}
      contacts={contacts}
      disabled={foregroundBusy}
      {...(activePlace ? { localPlaceId: activePlace.id } : {})}
      meta={meta}
      stationary={stationary}
    />
  );
}

/**
 * The presentation of a place's residents, separated from how they are
 * resolved so it can be proved against any ordered set of people (#231).
 */
export function ResidentContacts({
  className = "",
  contacts,
  disabled,
  localPlaceId,
  meta,
  stationary,
}: {
  className?: string;
  contacts: readonly ResidentContact[];
  disabled: boolean;
  /** The validated Local Place a merchant's counter trades in, if any. */
  localPlaceId?: string;
  meta?: ReactNode;
  stationary: boolean;
}) {
  // Nobody to talk to here. The place's own context still has to render: the
  // Long Scramble and the Processing Yard have no resident, and who else is
  // standing there is the place's information, not the resident's. It renders
  // bare rather than in an empty contact row.
  if (contacts.length === 0) {
    return meta ? (
      <div className={className.trim()} data-place-meta>
        {meta}
      </div>
    ) : null;
  }

  return (
    <div className={className.trim()} data-npc-residents>
      {contacts.map((contact, index) => (
        <LocalContact
          className={index > 0 ? "mt-3" : ""}
          contact={contact}
          disabled={disabled}
          key={contact.npc.id}
          localPlaceId={localPlaceId}
          stationary={stationary}
        />
      ))}
      {/* Place-level context, once, right-aligned on its own line after the
          people so it never reads as another line of anybody's description.
          `text-right` rather than `flex justify-end`: that flex wrapper
          shrink-wrapped its one child to a max-content width, which was fine
          for the collapsed trigger but then also boxed in the *expanded*
          population list and Character Profile to that same narrow width
          instead of the full Location panel (#207 follow-up). `text-align`
          only ever moves inline-level content (the trigger button, "Only you
          here") to the line's end; it never constrains a block box's own
          width, so the expanded list stays free to fill the row.
          `LocationPopulationPanel` resets the alignment back to `text-left`
          once content is meant to fill the row, so the cascade stops there. */}
      {meta ? (
        <div className="mt-2 text-right" data-place-meta>
          {meta}
        </div>
      ) : null}
      {!stationary ? (
        <Feedback tone="muted">
          Conversations with gameplay actions require a stationary character.
        </Feedback>
      ) : null}
    </div>
  );
}

/**
 * One resident's row. Each person keeps their own Talk and Trade surfaces and
 * their own open state, so two people in one place are two independent
 * interaction boundaries rather than one shared control.
 */
function LocalContact({
  className,
  contact,
  disabled,
  localPlaceId,
  stationary,
}: {
  className: string;
  contact: ResidentContact;
  disabled: boolean;
  localPlaceId?: string;
  stationary: boolean;
}) {
  const { npc, entries, merchant, guidance, turnInAvailable } = contact;
  const [open, setOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tradeTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      {/* Part of the place, not a card inside it (#193).

          This was briefly a bordered box, and it was the only surface on the
          screen with no bevel, no chamfer and no shadow — a second card sitting
          inside the Location panel's own raised surface, which read as a
          settings row rather than as somebody standing in the room. The fix is
          not a fancier nested panel: it is no panel. A hairline separates the
          resident from the place's description — and from the person before
          them — and the person and their actions sit directly on the Location
          surface.

          Deliberately still not a `Panel`: `rs-bevel`'s clip-path cuts anything
          painted outside the element's box, and a Mission-guided Talk paints a
          12px exterior halo. Nothing here clips, and nothing sets
          `overflow: hidden`, so that glow survives.

          Name and role are one identity block so they read as one person, and
          the actions sit beside it rather than competing with the name for the
          same baseline. */}
      <section
        aria-label={`Local contact: ${npc.displayName}`}
        className={`border-t border-[color:var(--rs-border-structural)] pt-3 ${className}`.trim()}
        data-npc-interaction={npc.id}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
          <div className="min-w-0 flex-1 basis-36">
            <h2 className="font-display text-base font-bold leading-tight">{npc.displayName}</h2>
            <p className="mt-0.5 text-xs leading-snug text-[color:var(--rs-text-secondary)]">
              {npc.role}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2" data-npc-actions>
            {entries.length > 0 ? (
              <MissionActionButton
                aria-label={`Talk to ${npc.displayName}`}
                data-npc-action="talk"
                data-npc-turn-in={turnInAvailable ? "true" : "false"}
                guidance={guidance}
                haloClassName="w-full"
                ref={triggerRef}
                disabled={disabled}
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
            <TradePanel {...(localPlaceId ? { localPlaceId } : {})} merchant={merchant} />
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
    </>
  );
}
