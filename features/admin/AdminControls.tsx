"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import type { PlayGameplayState } from "@/server/play";
import {
  adminAddItem,
  adminDeleteUniqueItem,
  adminForceUnequipItem,
  adminRemoveCargoStackQuantity,
  adminRemoveCarriedStackQuantity,
  adminResetAllMissions,
  adminResetMissionChain,
  adminSetSkillXp,
  adminStopCurrentAction,
  adminTeleportCharacter,
} from "@/server/admin-actions";
import {
  ADMIN_DESTINATIONS,
  ADMIN_OFFERED_ITEMS,
  XP_SHAPED_SKILLS,
  locationLabel,
  skillLabel,
} from "./admin-format";

/**
 * Operator controls for one character (Issue #113). Every control is a
 * confirmed, server-authoritative operator action that returns the refreshed
 * authoritative snapshot; the inspector swaps it in. Real mutations are
 * refresh-complete (state + audit); refused/no-op results apply the returned
 * state without touching the audit.
 */

export type AdminControlProps = {
  characterId: string;
  characterName: string;
  play: PlayGameplayState;
  applyState: (state: PlayGameplayState) => void;
  refreshAll: () => Promise<void>;
  bus: (message: string, tone: "success" | "danger" | "muted") => void;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel className="p-4" tone="raised">
      <h2 className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </Panel>
  );
}

/** A confirm-before-commit destructive operator action. */
function ConfirmAction({
  label,
  confirmLabel,
  prompt,
  disabled,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  /**
   * A concrete, operator-facing description of what WILL change on the target
   * character (names the affected entity/value). Shown only in the armed state
   * so the operator confirms the actual consequence, not a generic prompt.
   */
  prompt?: string;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [arming, setArming] = useState(false);
  const [pending, setPending] = useState(false);
  if (!arming) {
    return (
      <ActionButton
        intent="danger"
        disabled={disabled}
        onClick={() => setArming(true)}
        className="w-full"
      >
        {label}
      </ActionButton>
    );
  }
  return (
    <div className="rounded border border-[color:var(--rs-border-danger,var(--rs-border-structural))] bg-[color:var(--rs-surface)] p-2">
      {prompt ? <p className="mb-2 text-xs text-[color:var(--rs-text-primary)]">{prompt}</p> : null}
      <div className="flex items-center gap-2">
        <ActionButton
          intent="danger"
          loading={pending}
          disabled={disabled}
          onClick={async () => {
            setPending(true);
            try {
              await onConfirm();
            } finally {
              setPending(false);
              setArming(false);
            }
          }}
        >
          {confirmLabel}
        </ActionButton>
        <ActionButton intent="secondary" onClick={() => setArming(false)}>
          Cancel
        </ActionButton>
      </div>
    </div>
  );
}

export function AdminControls({
  characterId,
  characterName,
  play,
  applyState,
  refreshAll,
  bus,
}: AdminControlProps) {
  return (
    <div className="space-y-4">
      <StopAndLocationSection
        characterId={characterId}
        characterName={characterName}
        play={play}
        applyState={applyState}
        refreshAll={refreshAll}
        bus={bus}
      />
      <InventorySection
        characterId={characterId}
        characterName={characterName}
        play={play}
        applyState={applyState}
        refreshAll={refreshAll}
        bus={bus}
      />
      <EquipmentSection
        characterId={characterId}
        characterName={characterName}
        play={play}
        applyState={applyState}
        refreshAll={refreshAll}
        bus={bus}
      />
      <CargoSection
        characterId={characterId}
        characterName={characterName}
        play={play}
        applyState={applyState}
        refreshAll={refreshAll}
        bus={bus}
      />
      <MissionSection
        characterId={characterId}
        characterName={characterName}
        play={play}
        applyState={applyState}
        refreshAll={refreshAll}
        bus={bus}
      />
      <XpSection
        characterId={characterId}
        characterName={characterName}
        play={play}
        applyState={applyState}
        refreshAll={refreshAll}
        bus={bus}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function StopAndLocationSection(props: AdminControlProps) {
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
    <Section title="Stop & location">
      <ConfirmAction
        label="STOP current action"
        confirmLabel="Confirm stop"
        prompt={
          activeActionId
            ? `Stop the in-progress "${activeActionId}" action on "${characterName}".`
            : undefined
        }
        onConfirm={stop}
      />
      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
          <span className="block">TELEPORT / SET LOCATION</span>
          <select
            className="mt-1 block w-full border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-3 py-2 text-sm text-[color:var(--rs-text-primary)]"
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
            label={`Teleport here${activeActionId ? ` (stops ${activeActionId})` : ""}`}
            confirmLabel={`Move ${characterName} & stop ${activeActionId}`}
            prompt={`Teleport "${characterName}" to ${locationLabel(destination)} and interrupt the in-flight "${activeActionId}" action.`}
            onConfirm={teleport}
          />
        ) : (
          <ActionButton intent="danger" loading={pending} onClick={teleport} className="w-full">
            Teleport here
          </ActionButton>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function InventorySection(props: AdminControlProps) {
  const { characterId, characterName, play, applyState, refreshAll, bus } = props;
  const [removeState, setRemoveState] = useState<Record<string, "one" | "stack">>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");

  async function removeCarried(stackId: string, mode: "one" | "stack", expectedQuantity: number) {
    const response = await adminRemoveCarriedStackQuantity({
      characterId,
      stackId,
      mode,
      expectedQuantity,
    });
    if ("error" in response) return bus(response.error, "danger");
    if (response.outcome.kind === "removed") {
      applyState(response.state);
      await refreshAll();
      bus(
        `Removed ${response.outcome.removedQuantity} from carried (${response.outcome.source}).`,
        "success",
      );
    } else {
      applyState(response.state);
      bus(response.outcome.message, "muted");
    }
  }

  async function deleteUnique(itemInstanceId: string) {
    const response = await adminDeleteUniqueItem({ characterId, itemInstanceId });
    if ("error" in response) return bus(response.error, "danger");
    if (response.outcome.kind === "deleted") {
      applyState(response.state);
      await refreshAll();
      bus("Unique item deleted.", "success");
    } else {
      applyState(response.state);
      bus(response.outcome.message, "muted");
    }
  }

  async function add(itemId: string) {
    setAdding(itemId);
    try {
      const parsedQuantity = Number(quantity);
      const response = await adminAddItem({
        characterId,
        itemId,
        quantity:
          Number.isInteger(parsedQuantity) && parsedQuantity >= 1 ? parsedQuantity : undefined,
      });
      if ("error" in response) return bus(response.error, "danger");
      if (response.outcome.kind === "added") {
        applyState(response.state);
        await refreshAll();
        bus(`Added ${response.outcome.quantity} × ${response.outcome.itemId}.`, "success");
      } else {
        applyState(response.state);
        bus(response.outcome.message, "muted");
      }
    } finally {
      setAdding(null);
    }
  }

  return (
    <Section title="Carried inventory">
      {play.inventory.stacks.length === 0 ? (
        <p className="text-sm text-[color:var(--rs-text-muted)]">No carried stacks.</p>
      ) : (
        <ul className="space-y-2">
          {play.inventory.stacks.map((stack) => (
            <li
              key={stack.id}
              className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[color:var(--rs-text-primary)]">
                  {stack.name} · {stack.quantity}
                </span>
                <div className="flex items-center gap-2">
                  <select
                    className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-2 py-1 text-xs"
                    value={removeState[stack.id] ?? "one"}
                    onChange={(event) =>
                      setRemoveState((prev) => ({
                        ...prev,
                        [stack.id]: event.target.value as "one" | "stack",
                      }))
                    }
                  >
                    <option value="one">−1</option>
                    <option value="stack">−stack</option>
                  </select>
                  <ConfirmAction
                    label="Remove"
                    confirmLabel="Confirm"
                    prompt={
                      removeState[stack.id] === "stack"
                        ? `Remove the whole "${stack.name}" stack (${stack.quantity} × ${stack.itemId}) from "${characterName}"'s carried inventory.`
                        : `Remove 1 "${stack.name}" (${stack.itemId}) from "${characterName}"'s carried inventory.`
                    }
                    onConfirm={() =>
                      removeCarried(stack.id, removeState[stack.id] ?? "one", stack.quantity)
                    }
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {play.inventory.uniqueItems.length === 0 ? (
        <p className="text-sm text-[color:var(--rs-text-muted)]">No carried unique items.</p>
      ) : (
        <ul className="space-y-2">
          {play.inventory.uniqueItems.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] px-3 py-2 text-sm"
            >
              <span className="text-[color:var(--rs-text-primary)]">
                {item.name}
                {item.currentCharge !== undefined ? ` (charge ${item.currentCharge})` : ""}
              </span>
              <ConfirmAction
                label="Delete"
                confirmLabel="Delete unique"
                prompt={`Permanently delete the unique "${item.name}" (instance ${item.id}, ${item.itemId}) from "${characterName}"'s carried inventory.`}
                onConfirm={() => deleteUnique(item.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-[color:var(--rs-border-structural)] pt-3">
        <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
          ADD ITEM
        </p>
        <div className="mt-2 flex items-end gap-2">
          <label className="min-w-0 flex-1 text-xs text-[color:var(--rs-text-muted)]">
            <span className="block uppercase tracking-wide">Item</span>
            <select
              className="mt-1 block w-full border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-3 py-2 text-sm text-[color:var(--rs-text-primary)]"
              value={adding ?? ADMIN_OFFERED_ITEMS[0]?.itemId}
              onChange={(event) => setAdding(event.target.value)}
            >
              {ADMIN_OFFERED_ITEMS.map((option) => (
                <option key={option.itemId} value={option.itemId}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="w-20 text-xs text-[color:var(--rs-text-muted)]">
            <span className="block uppercase tracking-wide">Qty</span>
            <input
              className="mt-1 block w-full border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-3 py-2 text-sm text-[color:var(--rs-text-primary)]"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <ActionButton
            intent="secondary"
            onClick={() => add(adding ?? ADMIN_OFFERED_ITEMS[0]?.itemId)}
          >
            Add
          </ActionButton>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function EquipmentSection(props: AdminControlProps) {
  const { characterId, characterName, play, applyState, refreshAll, bus } = props;

  const equipped = play.equipment.slots.flatMap((slot) =>
    slot.item
      ? [{ itemInstanceId: slot.item.itemInstanceId, name: slot.item.name, slot: slot.label }]
      : [],
  );

  async function unequip(itemInstanceId: string) {
    const response = await adminForceUnequipItem({ characterId, itemInstanceId });
    if ("error" in response) return bus(response.error, "danger");
    if (response.outcome.kind === "unequipped") {
      applyState(response.state);
      await refreshAll();
      bus("Item force-unequipped.", "success");
    } else {
      applyState(response.state);
      bus(response.outcome.message, "muted");
    }
  }

  return (
    <Section title="Equipment">
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        Container slots: {play.equipment.aggregateContainerSlots}. FORCE UNEQUIP returns an item to
        carried inventory; an equipped unique must be unequipped before it can be deleted.
      </p>
      {equipped.length === 0 ? (
        <p className="text-sm text-[color:var(--rs-text-muted)]">Nothing equipped.</p>
      ) : (
        <ul className="space-y-2">
          {equipped.map((item) => (
            <li
              key={item.itemInstanceId}
              className="flex items-center justify-between gap-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] px-3 py-2 text-sm"
            >
              <span className="text-[color:var(--rs-text-primary)]">
                {item.name} <span className="text-[color:var(--rs-text-muted)]">({item.slot})</span>
              </span>
              <ConfirmAction
                label="Unequip"
                confirmLabel="Force unequip"
                prompt={`Force-unequip "${item.name}" (instance ${item.itemInstanceId}) from "${characterName}"'s ${item.slot} slot. If this is the Mining tool and a Mining action is live, that action will be stopped.`}
                onConfirm={() => unequip(item.itemInstanceId)}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

function CargoSection(props: AdminControlProps) {
  const { characterId, characterName, play, applyState, refreshAll, bus } = props;
  const [removeState, setRemoveState] = useState<Record<string, "one" | "stack">>({});

  async function removeCargo(stackId: string, mode: "one" | "stack", expectedQuantity: number) {
    const response = await adminRemoveCargoStackQuantity({
      characterId,
      stackId,
      mode,
      expectedQuantity,
    });
    if ("error" in response) return bus(response.error, "danger");
    if (response.outcome.kind === "removed") {
      applyState(response.state);
      await refreshAll();
      bus(`Removed ${response.outcome.removedQuantity} from Cargo.`, "success");
    } else {
      applyState(response.state);
      bus(response.outcome.message, "muted");
    }
  }

  async function deleteUnique(itemInstanceId: string) {
    const response = await adminDeleteUniqueItem({ characterId, itemInstanceId });
    if ("error" in response) return bus(response.error, "danger");
    if (response.outcome.kind === "deleted") {
      applyState(response.state);
      await refreshAll();
      bus("Unique item deleted from Cargo.", "success");
    } else {
      applyState(response.state);
      bus(response.outcome.message, "muted");
    }
  }

  return (
    <Section title="Cargo hold (operator)">
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        Repair is read-only here (player interaction owns it). Stacks and stored unique items can be
        removed by exact identity.
        {play.cargoHold.repair.complete
          ? ` Repair complete${play.cargoHold.repair.completedAt ? ` (${play.cargoHold.repair.completedAt})` : ""}.`
          : ` Repair in progress — ferrite ${play.cargoHold.repair.refinedFerriteContributed}/${play.cargoHold.repair.refinedFerriteRequired}, slag ${play.cargoHold.repair.slagContributed}/${play.cargoHold.repair.slagRequired}, weld ${play.cargoHold.repair.weldingProgress}.`}
      </p>

      {play.cargoHold.stacks.length === 0 ? (
        <p className="text-sm text-[color:var(--rs-text-muted)]">No Cargo stacks.</p>
      ) : (
        <ul className="space-y-2">
          {play.cargoHold.stacks.map((stack) => (
            <li
              key={stack.id}
              className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[color:var(--rs-text-primary)]">
                  {stack.name} · {stack.quantity} ({stack.itemId})
                </span>
                <div className="flex items-center gap-2">
                  <select
                    className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-2 py-1 text-xs"
                    value={removeState[stack.id] ?? "one"}
                    onChange={(event) =>
                      setRemoveState((prev) => ({
                        ...prev,
                        [stack.id]: event.target.value as "one" | "stack",
                      }))
                    }
                  >
                    <option value="one">−1</option>
                    <option value="stack">−stack</option>
                  </select>
                  <ConfirmAction
                    label="Remove"
                    confirmLabel="Confirm"
                    prompt={
                      removeState[stack.id] === "stack"
                        ? `Remove the whole Cargo stack "${stack.name}" (${stack.quantity} × ${stack.itemId}, stack ${stack.id}) from "${characterName}".`
                        : `Remove 1 "${stack.name}" (${stack.itemId}) from "${characterName}"'s Cargo hold.`
                    }
                    onConfirm={() =>
                      removeCargo(stack.id, removeState[stack.id] ?? "one", stack.quantity)
                    }
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {play.cargoHold.uniqueItems.length === 0 ? (
        <p className="text-sm text-[color:var(--rs-text-muted)]">
          No stored unique items in Cargo.
        </p>
      ) : (
        <ul className="space-y-2">
          {play.cargoHold.uniqueItems.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] px-3 py-2 text-sm"
            >
              <span className="text-[color:var(--rs-text-primary)]">
                {item.name}
                {item.currentCharge !== undefined ? ` (charge ${item.currentCharge})` : ""}
                <span className="text-[color:var(--rs-text-muted)]"> ({item.itemId})</span>
              </span>
              <ConfirmAction
                label="Delete"
                confirmLabel="Delete unique"
                prompt={`Permanently delete the unique "${item.name}" (instance ${item.id}, ${item.itemId}) stored in "${characterName}"'s Cargo hold.`}
                onConfirm={() => deleteUnique(item.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

function MissionSection(props: AdminControlProps) {
  const { characterId, characterName, play, applyState, refreshAll, bus } = props;

  async function resetChain(missionId: string) {
    const response = await adminResetMissionChain({ characterId, missionId });
    if ("error" in response) return bus(response.error, "danger");
    if (response.outcome.kind === "reset") {
      applyState(response.state);
      await refreshAll();
      bus(`Reset ${response.outcome.deleted} mission row(s) from this chain.`, "success");
    } else {
      applyState(response.state);
      bus("Nothing to reset in this chain.", "muted");
    }
  }

  async function resetAll() {
    const response = await adminResetAllMissions({ characterId });
    if ("error" in response) return bus(response.error, "danger");
    if (response.outcome.kind === "reset") {
      applyState(response.state);
      await refreshAll();
      bus(`Reset all missions for this character (${response.outcome.deleted} row(s)).`, "success");
    } else {
      applyState(response.state);
      bus("No missions recorded for this character.", "muted");
    }
  }

  return (
    <Section title="Missions">
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        RESET FROM THIS MISSION also clears its transitive chain. RESET ALL is scoped to this
        character only — never the whole population.
      </p>
      <ConfirmAction
        label="RESET ALL missions (this character)"
        confirmLabel="Confirm reset all"
        prompt={`Reset ALL currently-authored mission records for "${characterName}" (they will need to be re-accepted).`}
        onConfirm={resetAll}
      />
      {/* Per-mission chain reset is driven from the server-derived mission
          projections on the selected character — never a hardcoded mission id
          (issue #124 guardrail: no mission-ID branches in feature components). */}
      {play.missions.length === 0 ? (
        <p className="text-sm text-[color:var(--rs-text-muted)]">
          No missions present for this character to reset from.
        </p>
      ) : (
        <ul className="space-y-2">
          {play.missions.map((mission) => (
            <li key={mission.missionId}>
              <ConfirmAction
                label={`RESET FROM THIS MISSION (${mission.title})`}
                confirmLabel="Confirm reset chain"
                prompt={`Reset the mission chain rooted at "${mission.title}" (${mission.missionId}) for "${characterName}".`}
                onConfirm={() => resetChain(mission.missionId)}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

function XpSection(props: AdminControlProps) {
  const { characterId, characterName, play, applyState, refreshAll, bus } = props;
  const [skillId, setSkillId] = useState<string>(XP_SHAPED_SKILLS[0]);
  const [value, setValue] = useState("0");
  const [pending, setPending] = useState(false);

  async function setXp() {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0)
      return bus("Total XP must be a non-negative integer.", "danger");
    setPending(true);
    try {
      const response = await adminSetSkillXp({ characterId, skillId, totalXp: parsed });
      if ("error" in response) return bus(response.error, "danger");
      if (response.outcome.kind === "set") {
        applyState(response.state);
        await refreshAll();
        bus(
          `Set ${skillLabel(response.outcome.skillId)} XP to ${response.outcome.after} (was ${response.outcome.before}).`,
          "success",
        );
      } else {
        applyState(response.state);
        bus(`No change; ${skillLabel(skillId)} is already there.`, "muted");
      }
    } finally {
      setPending(false);
    }
  }

  const totals: Record<string, number> = {
    mining: play.mining.totalXp,
    refining: play.refining.totalXp,
    welding: play.welding.totalXp,
  };
  const currentInSkill = totals[skillId] ?? 0;
  const parsedForConfirm = Number(value);
  const differs =
    Number.isInteger(parsedForConfirm) &&
    parsedForConfirm >= 0 &&
    parsedForConfirm !== currentInSkill;

  return (
    <Section title="Skill total XP">
      <ul className="space-y-1 text-xs text-[color:var(--rs-text-muted)]">
        {XP_SHAPED_SKILLS.map((id) => (
          <li key={id}>
            {skillLabel(id)}: {totals[id]}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-end gap-2">
        <label className="min-w-0 flex-1 text-xs text-[color:var(--rs-text-muted)]">
          <span className="block uppercase tracking-wide">Skill</span>
          <select
            className="mt-1 block w-full border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-3 py-2 text-sm text-[color:var(--rs-text-primary)]"
            value={skillId}
            onChange={(event) => setSkillId(event.target.value)}
          >
            {XP_SHAPED_SKILLS.map((id) => (
              <option key={id} value={id}>
                {skillLabel(id)}
              </option>
            ))}
          </select>
        </label>
        <label className="w-28 text-xs text-[color:var(--rs-text-muted)]">
          <span className="block uppercase tracking-wide">Total XP</span>
          <input
            className="mt-1 block w-full border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-3 py-2 text-sm text-[color:var(--rs-text-primary)]"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="numeric"
          />
        </label>
        {differs ? (
          <ConfirmAction
            label="Set"
            confirmLabel="Confirm set"
            prompt={`Set ${skillLabel(skillId)} total XP for "${characterName}" from ${currentInSkill} to ${parsedForConfirm}.`}
            onConfirm={setXp}
          />
        ) : (
          <ActionButton intent="secondary" loading={pending} onClick={setXp}>
            Set
          </ActionButton>
        )}
      </div>
    </Section>
  );
}
