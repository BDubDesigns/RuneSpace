"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { adminStopCurrentAction, adminTeleportCharacter } from "@/server/admin-actions";
import type { AdminInspectorState } from "@/server/admin-state";
import { ConfirmAction } from "./ConfirmAction";
import { ADMIN_DESTINATIONS, locationLabel } from "./admin-format";
import { controlClass, Field, IsoTimestamp, Section, type AdminTabProps } from "./AdminParts";

/**
 * Overview tab (#333): who the character is, where it is and what it is doing,
 * with the two controls that act on exactly that — STOP and TELEPORT.
 */
export function AdminOverviewTab({
  state,
  ...props
}: AdminTabProps & { state: AdminInspectorState }) {
  const { characterId, characterName, play, applyState, refreshAll, bus } = props;
  const [destination, setDestination] = useState(play.location.currentLocationId);
  const [pending, setPending] = useState(false);

  async function stop() {
    setPending(true);
    try {
      const response = await adminStopCurrentAction({ characterId });
      if ("error" in response) return bus(response.error, "danger");
      if (response.outcome.kind === "interrupted") {
        applyState(response.state);
        await refreshAll();
        bus("Current action stopped.", "success");
      } else {
        applyState(response.state);
        bus("Character is already idle.", "muted");
      }
    } finally {
      setPending(false);
    }
  }

  async function teleport() {
    setPending(true);
    try {
      const response = await adminTeleportCharacter({
        characterId,
        destinationLocationId: destination,
      });
      if ("error" in response) return bus(response.error, "danger");
      if (response.outcome.kind === "teleported") {
        applyState(response.state);
        await refreshAll();
        bus(
          `Teleported to ${locationLabel(response.outcome.toLocationId)}${
            response.outcome.interruptedActionId ? " (interrupted an in-flight action)" : ""
          }.`,
          "success",
        );
      } else {
        applyState(response.state);
        bus("Already there; nothing changed.", "muted");
      }
    } finally {
      setPending(false);
    }
  }

  const activeActionId = play.activeAction?.actionId;

  return (
    <div className="space-y-4">
      <Section title="Character">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Field label="Display name">{state.displayName}</Field>
          <Field label="Character ID">{state.characterId}</Field>
          <Field label="Owner">
            {state.owner.maskedEmail ?? "unknown"}
            <span className="block text-xs text-[color:var(--rs-text-muted)]">
              {state.owner.playerAccountId}
            </span>
          </Field>
        </dl>
      </Section>

      <Section title="Location & action">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Field label="Location">
            {locationLabel(state.currentLocationId)}
            <span className="block text-xs text-[color:var(--rs-text-muted)]">
              {state.currentLocationId}
            </span>
          </Field>
          <Field label="Current action">{activeActionId ?? "idle"}</Field>
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
        </dl>

        <ConfirmAction
          label={activeActionId ? "STOP current action" : "STOP current action (none in progress)"}
          confirmLabel="Confirm stop"
          intent="danger"
          fullWidth
          disabled={!activeActionId}
          prompt={
            activeActionId
              ? `Stop the in-progress "${activeActionId}" action on "${characterName}".`
              : undefined
          }
          onConfirm={stop}
        />
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 basis-48 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
            <span className="block">TELEPORT / SET LOCATION</span>
            <select
              className={controlClass}
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            >
              {ADMIN_DESTINATIONS.map((option) => (
                <option key={option.locationId} value={option.locationId}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {activeActionId ? (
            <ConfirmAction
              label={`Teleport here (stops ${activeActionId})`}
              confirmLabel={`Move ${characterName} & stop ${activeActionId}`}
              intent="secondary"
              prompt={`Teleport "${characterName}" to ${locationLabel(destination)} and interrupt the in-flight "${activeActionId}" action.`}
              onConfirm={teleport}
            />
          ) : (
            <ActionButton intent="secondary" loading={pending} onClick={teleport}>
              Teleport here
            </ActionButton>
          )}
        </div>
      </Section>
    </div>
  );
}
