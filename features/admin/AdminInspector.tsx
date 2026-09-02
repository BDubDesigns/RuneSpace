"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import type { AdminInspectorState, AdminMissionDetail } from "@/server/admin-state";
import type { PlayGameplayState } from "@/server/play";
import { adminLoadInspector } from "@/server/admin-actions";
import { AdminControls } from "./AdminControls";
import { AdminAuditTrail } from "./AdminAuditTrail";
import { locationLabel, skillLabel } from "./admin-format";

/**
 * Operator inspector for one character (Issue #113). Holds the authoritative
 * snapshot and renders the FULL #113 read model — identity, location/action,
 * Travel timing, carried stacks/unique instances, equipment slots + capacity,
 * Cargo repair/stacks/unique instances, authored-mission status with
 * prerequisites and timestamps, skills with derived level/progress, and recent
 * operator history — plus the operator controls. After each confirmed mutation
 * the snapshot is swapped in place and the audit trail re-reads so both stay
 * coherent; refresh failures surface without losing the last known-good state.
 */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">{label}</dt>
      <dd className="text-[color:var(--rs-text-primary)]">{children}</dd>
    </>
  );
}

function IsoTimestamp({ value }: { value?: string }) {
  if (!value) return <span className="text-[color:var(--rs-text-muted)]">—</span>;
  // Authoritative timestamps are already ISO strings ending in "Z"; never
  // append a second "Z".
  const shown = value.endsWith("Z") ? value : `${value}Z`;
  return <span className="text-xs text-[color:var(--rs-text-primary)]">{shown}</span>;
}

/** Renders every occupied equipment slot with canonical ID + instance ID. */
function EquipmentSlotRows({ play }: { play: PlayGameplayState }) {
  return (
    <>
      {play.equipment.slots.map((slot) => {
        const item = slot.item;
        return (
          <Field key={`${slot.target.assignmentKind}:${slot.target.suitSlotId}`} label={slot.label}>
            {item ? `${item.name} · ${item.itemId}` : "empty"}
            <span className="block text-xs text-[color:var(--rs-text-muted)]">
              {slot.target.assignmentKind}:{slot.target.suitSlotId}
              {item ? ` · instance ${item.itemInstanceId}` : ""}
            </span>
          </Field>
        );
      })}
    </>
  );
}

function MissionRows({ missions }: { missions: readonly AdminMissionDetail[] }) {
  if (missions.length === 0) {
    return <div className="text-sm text-[color:var(--rs-text-muted)]">No authored missions.</div>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {missions.map((mission) => (
        <li
          key={mission.missionId}
          className="rounded border border-[color:var(--rs-border-structural)] p-2"
        >
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium">{mission.title}</span>
            <span className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
              {mission.missionId}
            </span>
            <span
              className={`rounded px-1.5 text-xs uppercase ${
                mission.status === "completed"
                  ? "bg-green-900/30 text-green-300"
                  : mission.status === "accepted"
                    ? "bg-amber-900/30 text-amber-300"
                    : "bg-slate-800/40 text-[color:var(--rs-text-muted)]"
              }${mission.stale ? "ring-1 ring-yellow-800/60" : ""}`}
            >
              {mission.stale ? "stale" : mission.status}
            </span>
          </div>
          <div className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
            {mission.prerequisiteMissionId ? `Requires ${mission.prerequisiteMissionId} · ` : ""}
            {mission.status === "not_accepted"
              ? "not accepted"
              : `accepted ${mission.acceptedAt ?? "—"}`}
            {mission.completedAt ? ` · completed ${mission.completedAt}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

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
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]">
            State snapshot
          </h2>
          <span className="font-display text-base">{state.displayName}</span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Field label="Character ID">{state.characterId}</Field>
          <Field label="Owner">
            {state.owner.maskedEmail ?? "unknown"}
            <span className="block text-xs text-[color:var(--rs-text-muted)]">
              {state.owner.playerAccountId}
            </span>
          </Field>
          <Field label="Location">
            {locationLabel(state.currentLocationId)}
            <span className="block text-xs text-[color:var(--rs-text-muted)]">
              {state.currentLocationId}
            </span>
          </Field>
          <Field label="Current action">{play.activeAction?.actionId ?? "idle"}</Field>

          {play.travelState ? (
            <>
              <Field label="Travel origin">
                {locationLabel(play.travelState.originLocationId)}
              </Field>
              <Field label="Travel destination">
                {locationLabel(play.travelState.destinationLocationId)}
              </Field>
              <Field label="Travel started">
                <IsoTimestamp value={play.travelState.startedAt} />
              </Field>
              <Field label="Arrives">
                <IsoTimestamp value={play.travelState.arrivesAt} />
              </Field>
            </>
          ) : null}

          {(["mining", "refining", "welding"] as const).map((key) => (
            <Field key={key} label={skillLabel(key)}>
              {play[key].totalXp} XP · level {play[key].level}
              <span className="block text-xs text-[color:var(--rs-text-muted)]">
                {play[key].xpIntoLevel}
                {play[key].xpToNextLevel !== undefined
                  ? ` / ${play[key].xpToNextLevel} into next level`
                  : ""}
              </span>
            </Field>
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

      <Panel className="p-4" tone="raised">
        <h2 className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]">
          Carried inventory
        </h2>
        <div className="mt-2 text-xs text-[color:var(--rs-text-muted)]">
          {play.inventory.slotsUsed} used · {play.inventory.slotsAvailable} available ·{" "}
          {play.inventory.massGrams}/{play.inventory.capacityGrams} g
        </div>
        {play.inventory.stacks.length === 0 && play.inventory.uniqueItems.length === 0 ? (
          <div className="mt-2 text-sm text-[color:var(--rs-text-muted)]">Empty.</div>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {play.inventory.stacks.map((stack) => (
              <li key={stack.id} className="flex justify-between">
                <span>
                  {stack.name} (stack {stack.id})
                </span>
                <span className="text-[color:var(--rs-text-muted)]">
                  {stack.quantity} · {stack.itemId}
                </span>
              </li>
            ))}
            {play.inventory.uniqueItems.map((item) => (
              <li key={item.id} className="flex justify-between">
                <span>
                  {item.name} (instance {item.id})
                </span>
                <span className="text-[color:var(--rs-text-muted)]">
                  {item.itemId}
                  {item.currentCharge !== undefined ? ` · charge ${item.currentCharge}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="p-4" tone="raised">
        <h2 className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]">
          Equipment
        </h2>
        <div className="mt-2 text-xs text-[color:var(--rs-text-muted)]">
          Container slots: {play.equipment.aggregateContainerSlots}
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <EquipmentSlotRows play={play} />
        </dl>
        {play.equipment.salvageCutter ? (
          <div className="mt-2 text-xs text-[color:var(--rs-text-muted)]">
            Salvage Cutter charge {play.equipment.salvageCutter.currentCharge}/
            {play.equipment.salvageCutter.maximumCharge}
          </div>
        ) : null}
      </Panel>

      <Panel className="p-4" tone="raised">
        <h2 className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]">
          Unique item instances
        </h2>
        <div className="mt-2 text-xs text-[color:var(--rs-text-muted)]">
          Every occupied unique instance with its canonical item ID, instance ID, mutable state, and
          location (equipped slot / carried / Cargo).
        </div>
        {state.uniqueInstances.length === 0 ? (
          <div className="mt-2 text-sm text-[color:var(--rs-text-muted)]">
            No unique item instances.
          </div>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {state.uniqueInstances.map((instance) => (
              <li key={instance.instanceId} className="flex justify-between">
                <span>
                  {instance.itemId} · instance {instance.instanceId}
                </span>
                <span className="text-[color:var(--rs-text-muted)]">
                  {instance.location}
                  {instance.currentCharge !== undefined
                    ? ` · charge ${instance.currentCharge}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="p-4" tone="raised">
        <h2 className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]">
          Cargo hold
        </h2>
        <div className="mt-2 text-xs text-[color:var(--rs-text-muted)]">
          {play.cargoHold.slotsUsed}/{play.cargoHold.capacitySlots} slots
          {play.cargoHold.repair.complete ? " · repair complete" : " · repair in progress"}
        </div>
        <div className="mt-2 text-xs text-[color:var(--rs-text-muted)]">
          Repair: ferrite {play.cargoHold.repair.refinedFerriteContributed}/
          {play.cargoHold.repair.refinedFerriteRequired} · slag{" "}
          {play.cargoHold.repair.slagContributed}/{play.cargoHold.repair.slagRequired} · weld{" "}
          {play.cargoHold.repair.weldingProgress}
          {play.cargoHold.repair.completedAt
            ? ` · completed ${play.cargoHold.repair.completedAt}`
            : ""}
        </div>
        {play.cargoHold.stacks.length === 0 && play.cargoHold.uniqueItems.length === 0 ? (
          <div className="mt-2 text-sm text-[color:var(--rs-text-muted)]">Empty.</div>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {play.cargoHold.stacks.map((stack) => (
              <li key={stack.id} className="flex justify-between">
                <span>
                  {stack.name} (stack {stack.id})
                </span>
                <span className="text-[color:var(--rs-text-muted)]">
                  {stack.quantity} · {stack.itemId}
                </span>
              </li>
            ))}
            {play.cargoHold.uniqueItems.map((item) => (
              <li key={item.id} className="flex justify-between">
                <span>
                  {item.name} (instance {item.id})
                </span>
                <span className="text-[color:var(--rs-text-muted)]">
                  {item.itemId}
                  {item.currentCharge !== undefined ? ` · charge ${item.currentCharge}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="p-4" tone="raised">
        <h2 className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]">
          Missions
        </h2>
        <div className="mt-2">
          <MissionRows missions={state.missions} />
        </div>
      </Panel>

      <AdminControls
        characterId={state.characterId}
        characterName={state.displayName}
        play={play}
        applyState={applyPlay}
        refreshAll={refreshAll}
        bus={bus}
      />

      <AdminAuditTrail rows={state.audit} />
    </div>
  );
}
