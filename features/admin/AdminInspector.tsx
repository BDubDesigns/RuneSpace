"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import type { AdminInspectorState } from "@/server/admin-state";
import type { PlayGameplayState } from "@/server/play";
import { adminLoadInspector } from "@/server/admin-actions";
import { AdminControls } from "./AdminControls";
import { AdminAuditTrail } from "./AdminAuditTrail";
import { locationLabel, skillLabel } from "./admin-format";

/**
 * Operator inspector for one character (Issue #113). Holds the authoritative
 * snapshot and renders the summary, operator controls, and immutable audit
 * history as one console. After each confirmed mutation the snapshot is swapped
 * in place and the audit trail re-reads so both stay coherent; refresh failures
 * surface without losing the last known-good state.
 */
export function AdminInspector({ initial }: { initial: AdminInspectorState }) {
  const [state, setState] = useState<AdminInspectorState>(initial);
  const [message, setMessage] = useState<{
    text: string;
    tone: "success" | "danger" | "muted";
  } | null>(null);
  const [refreshing, startRefresh] = useTransition();

  function applyPlay(next: PlayGameplayState) {
    setState((prev) => ({
      ...prev,
      play: next,
      currentLocationId: next.location.currentLocationId,
    }));
  }

  async function refreshAll() {
    const response = await adminLoadInspector({ characterId: state.characterId });
    if ("error" in response) {
      setMessage({ text: response.error, tone: "danger" });
      return;
    }
    setState(response.state);
  }

  function bus(text: string, tone: "success" | "danger" | "muted") {
    setMessage({ text, tone });
  }

  const { play } = state;

  return (
    <div className="space-y-4">
      <Panel className="p-4" tone="raised">
        <h2 className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]">
          State snapshot
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
            Location
          </dt>
          <dd className="text-[color:var(--rs-text-primary)]">
            {locationLabel(state.currentLocationId)}
            {play.travelState
              ? ` → ${locationLabel(play.travelState.destinationLocationId)} (in transit)`
              : ""}
          </dd>
          <dt className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
            Current action
          </dt>
          <dd className="text-[color:var(--rs-text-primary)]">
            {play.activeAction?.actionId ?? "idle"}
          </dd>
          {([["mining"], ["refining"], ["welding"]] as const).map(([key]) => (
            <div key={key} className="contents">
              <dt className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                {skillLabel(key)}
              </dt>
              <dd className="text-[color:var(--rs-text-primary)]">{play[key].totalXp} XP</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex items-center gap-3">
          <ActionButton
            intent="secondary"
            loading={refreshing}
            onClick={() =>
              startRefresh(async () => {
                await refreshAll();
              })
            }
          >
            Refresh state
          </ActionButton>
          {message ? <Feedback tone={message.tone}>{message.text}</Feedback> : null}
        </div>
      </Panel>

      <AdminControls
        characterId={state.characterId}
        play={play}
        applyState={applyPlay}
        refreshAll={refreshAll}
        bus={bus}
      />

      <AdminAuditTrail rows={state.audit} />
    </div>
  );
}
