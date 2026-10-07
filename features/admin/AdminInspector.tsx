"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import type { AdminInspectorState } from "@/server/admin-state";
import type { PlayGameplayState } from "@/server/play";
import { adminLoadInspector } from "@/server/admin-actions";
import { AdminAccountAccessPanel } from "./AdminAccountAccessPanel";
import { AdminAuditTrail } from "./AdminAuditTrail";
import { AdminInventoryTab } from "./AdminInventoryTab";
import { AdminMissionsTab } from "./AdminMissionsTab";
import { AdminModerationPanel } from "./AdminModerationPanel";
import { AdminOverviewTab } from "./AdminOverviewTab";
import type { AdminTabProps } from "./AdminParts";
import { AdminSkillsTab } from "./AdminSkillsTab";
import { AdminTabList, adminTabId, adminTabPanelId } from "./AdminTabList";

/**
 * Operator inspector for one character (Issue #113, tabbed in #333). Holds the
 * authoritative snapshot and shows one section at a time — Overview, Inventory,
 * Missions, Skills, Account, Moderation, History — each with the state and the
 * controls that change it side by side. The selected character's identity, the
 * refresh action and the latest mutation result stay above the tabs so they are
 * visible from every section.
 *
 * After each confirmed mutation the snapshot is swapped in place and the audit
 * trail re-reads so both stay coherent; refresh failures surface without losing
 * the last known-good state. The snapshot lives here, above the tabs, so
 * switching tabs never discards refreshed state; only a tab's own unsubmitted
 * form input and armed confirmations are dropped.
 */

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "inventory", label: "Inventory" },
  { id: "missions", label: "Missions" },
  { id: "skills", label: "Skills" },
  { id: "account", label: "Account" },
  { id: "moderation", label: "Moderation" },
  { id: "history", label: "History" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AdminInspector({ initial }: { initial: AdminInspectorState }) {
  const [state, setState] = useState<AdminInspectorState>(initial);
  const [tab, setTab] = useState<TabId>("overview");
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

  const tabProps: AdminTabProps = {
    characterId: state.characterId,
    characterName: state.displayName,
    play: state.play,
    applyState: applyPlay,
    refreshAll,
    bus,
  };

  return (
    <div className="space-y-4">
      <Panel className="p-4" tone="raised" data-testid="admin-inspector-header">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h2 className="font-display text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
              Character inspector
            </h2>
            <p className="break-words font-display text-base">{state.displayName}</p>
            <p className="break-all font-mono text-[10px] text-[color:var(--rs-text-muted)]">
              {state.characterId}
            </p>
          </div>
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
        </div>
      </Panel>

      {/* The tabs and the latest result stay in view while a long section
          scrolls, so a mutation's outcome is never left off-screen. */}
      <div
        className="sticky top-0 z-10 bg-[color:var(--rs-surface-panel)]"
        data-testid="admin-inspector-nav"
      >
        <AdminTabList tabs={TABS} selected={tab} onSelect={setTab} />
        {message ? (
          <div className="pb-1">
            <Feedback tone={message.tone}>{message.text}</Feedback>
          </div>
        ) : null}
      </div>

      <div
        aria-labelledby={adminTabId(tab)}
        className="space-y-4"
        id={adminTabPanelId(tab)}
        role="tabpanel"
        tabIndex={0}
      >
        {tab === "overview" ? <AdminOverviewTab state={state} {...tabProps} /> : null}
        {tab === "inventory" ? <AdminInventoryTab state={state} {...tabProps} /> : null}
        {tab === "missions" ? <AdminMissionsTab state={state} {...tabProps} /> : null}
        {tab === "skills" ? <AdminSkillsTab {...tabProps} /> : null}
        {tab === "account" ? (
          <AdminAccountAccessPanel
            access={state.accountAccess}
            onChange={(accountAccess) => setState((prev) => ({ ...prev, accountAccess }))}
            bus={bus}
          />
        ) : null}
        {tab === "moderation" ? <AdminModerationPanel characterId={state.characterId} /> : null}
        {tab === "history" ? <AdminAuditTrail rows={state.audit} /> : null}
      </div>
    </div>
  );
}
