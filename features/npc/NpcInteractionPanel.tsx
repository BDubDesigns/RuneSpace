"use client";

import { useRef, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { NpcConversation } from "@/features/npc/NpcConversation";
import { getResidentNpc } from "@/game/content/npcs";
import { resolveNpcConversation } from "@/game/domain/conversation";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";
import { usePlay } from "@/features/play/PlayContext";

/**
 * The stationary NPC interaction surface: one `Talk to <NPC>` control that opens
 * the canonical conversation hub.
 *
 * The available conversations come from ONE generic resolver over authoritative
 * mission projections and authored conversation topics. This panel contains no
 * per-mission ID chains and never parses player-facing objective copy, so a new
 * ordinary mission or a new authored topic appears here without edits.
 *
 * `localPlaceId` is the Local Place the player currently has open. It is
 * navigation/presentation state passed down from the route, never authoritative
 * position: the resident it resolves decides who can be talked to here, while
 * every gameplay command still revalidates its own location server-side.
 */
export function NpcInteractionPanel({ localPlaceId }: { localPlaceId?: string }) {
  const { foregroundBusy, state } = usePlay();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const npc = getResidentNpc({ locationId: state.location.currentLocationId, localPlaceId });
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
      : undefined;
  const guidanceValue = hasActiveGuidance
    ? "active"
    : hasAvailableGuidance
      ? "available"
      : undefined;
  if (!npc || entries.length === 0) return null;
  // The Talk control reads as a turn-in exactly when one of the currently
  // available conversations drives a completion command right now.
  const turnInAvailable =
    stationary &&
    entries.some((entry) => entry.kind === "mission" && entry.action?.kind === "complete_mission");

  return (
    <>
      <Panel className="!p-4" data-npc-interaction>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-display text-[11px] uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]">
              Local contact
            </p>
            <h2 className="mt-1 font-display text-lg font-bold">{npc.displayName}</h2>
            <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">{npc.role}</p>
          </div>
          <ActionButton
            className={guidanceClass}
            data-npc-turn-in={turnInAvailable ? "true" : "false"}
            data-mission-guidance={guidanceValue}
            ref={triggerRef}
            disabled={foregroundBusy}
            intent={turnInAvailable ? "mission" : "secondary"}
            onClick={() => setOpen(true)}
          >
            Talk to {npc.displayName}
          </ActionButton>
        </div>
        {!stationary ? (
          <Feedback tone="muted">
            Conversations with gameplay actions require a stationary character.
          </Feedback>
        ) : null}
      </Panel>
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
