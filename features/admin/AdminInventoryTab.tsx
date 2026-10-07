"use client";

import { useMemo, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import {
  adminAddItem,
  adminDeleteUniqueItem,
  adminForceUnequipItem,
  adminRemoveCargoStackQuantity,
  adminRemoveCarriedStackQuantity,
} from "@/server/admin-actions";
import type { AdminInspectorState } from "@/server/admin-state";
import type { PlayGameplayState } from "@/server/play";
import { ConfirmAction } from "./ConfirmAction";
import { adminGrantableItems, filterAdminGrantableItems, itemLabel } from "./admin-format";
import { controlClass, listItemClass, Section, type AdminTabProps } from "./AdminParts";

/**
 * Inventory tab (#333): carried inventory with Add/Remove Item, equipment with
 * Force Unequip, the Cargo hold with its controls, and every unique instance —
 * each section showing the state beside the controls that change it.
 */

type RemoveMode = "one" | "stack";

type StackRow = { id: string; itemId: string; name: string; quantity: number };

/**
 * One stack with the exact-identity remove control (−1 or the whole stack).
 * `scope` words the confirmation for where the stack lives.
 */
function StackRow({
  stack,
  scope,
  testId,
  onRemove,
}: {
  stack: StackRow;
  scope: { whole: string; one: string };
  testId: string;
  onRemove: (stackId: string, mode: RemoveMode, expectedQuantity: number) => Promise<void>;
}) {
  const [mode, setMode] = useState<RemoveMode>("one");
  return (
    <li className={listItemClass} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[color:var(--rs-text-primary)]">
          {stack.name} × {stack.quantity}
          <span className="block break-all font-mono text-[10px] text-[color:var(--rs-text-muted)]">
            {stack.itemId} · stack {stack.id}
          </span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`Amount to remove from ${stack.name}`}
            className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-2 py-1 text-xs"
            value={mode}
            onChange={(event) => setMode(event.target.value as RemoveMode)}
          >
            <option value="one">−1</option>
            <option value="stack">−stack</option>
          </select>
          <ConfirmAction
            label="Remove"
            confirmLabel="Confirm"
            prompt={mode === "stack" ? scope.whole : scope.one}
            onConfirm={() => onRemove(stack.id, mode, stack.quantity)}
          />
        </div>
      </div>
    </li>
  );
}

type UniqueRow = { id: string; itemId: string; name: string; currentCharge?: number };

function UniqueRow({
  item,
  testId,
  prompt,
  onDelete,
}: {
  item: UniqueRow;
  testId: string;
  prompt: string;
  onDelete: (itemInstanceId: string) => Promise<void>;
}) {
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-2 ${listItemClass}`}
      data-testid={testId}
    >
      <span className="text-[color:var(--rs-text-primary)]">
        {item.name}
        <span className="block break-all font-mono text-[10px] text-[color:var(--rs-text-muted)]">
          {item.itemId}
          {item.currentCharge !== undefined ? ` · charge ${item.currentCharge}` : ""} · instance{" "}
          {item.id}
        </span>
      </span>
      <ConfirmAction
        label="Delete"
        confirmLabel="Delete unique"
        prompt={prompt}
        onConfirm={() => onDelete(item.id)}
      />
    </li>
  );
}

/** ADD ITEM: the whole canonical catalog behind a name filter. */
function AddItemControl({
  characterId,
  applyState,
  refreshAll,
  bus,
}: Pick<AdminTabProps, "characterId" | "applyState" | "refreshAll" | "bus">) {
  const catalog = useMemo(() => adminGrantableItems(), []);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(catalog[0]?.itemId);
  const [quantity, setQuantity] = useState("1");
  const [pending, setPending] = useState(false);

  const matches = filterAdminGrantableItems(catalog, filter);
  // A filter can hide the chosen item; the effective choice is then the first
  // visible match, so the select and the Add button never disagree.
  const selected = matches.find((item) => item.itemId === selectedId) ?? matches[0];
  const unique = selected?.kind === "unique";

  async function add() {
    if (!selected) return bus("Choose an item to add.", "danger");
    // Stackable: refuse invalid input BEFORE calling the action. A non
    // positive-integer quantity must never silently become "add one". Unique
    // items are always one-per-command, so no quantity is ever sent for them.
    let amount: number | undefined;
    if (!unique) {
      amount = Number(quantity);
      if (!Number.isInteger(amount) || amount < 1) {
        return bus("Quantity must be a positive whole number before adding.", "danger");
      }
    }
    setPending(true);
    try {
      const response = await adminAddItem({
        characterId,
        itemId: selected.itemId,
        quantity: amount,
      });
      if ("error" in response) return bus(response.error, "danger");
      applyState(response.state);
      if (response.outcome.kind === "added") {
        await refreshAll();
        bus(`Added ${response.outcome.quantity} × ${selected.label}.`, "success");
      } else {
        bus(`Could not add ${selected.label}: ${response.outcome.message}`, "danger");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-t border-[color:var(--rs-border-structural)] pt-3">
      <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">ADD ITEM</p>
      <label className="mt-2 block text-xs text-[color:var(--rs-text-muted)]">
        <span className="block uppercase tracking-wide">Find item</span>
        <input
          className={controlClass}
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name"
          autoComplete="off"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-48 text-xs text-[color:var(--rs-text-muted)]">
          <span className="block uppercase tracking-wide">Item</span>
          <select
            className={controlClass}
            value={selected?.itemId ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
            disabled={matches.length === 0}
          >
            {matches.length === 0 ? <option value="">No matching items</option> : null}
            {matches.map((option) => (
              <option key={option.itemId} value={option.itemId}>
                {option.label}
                {option.kind === "unique" ? " (unique)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="w-20 text-xs text-[color:var(--rs-text-muted)]">
          <span className="block uppercase tracking-wide">Qty</span>
          <input
            className={`${controlClass} disabled:cursor-not-allowed disabled:opacity-50`}
            value={unique ? "1" : quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="numeric"
            disabled={unique}
            aria-disabled={unique}
            title={
              unique
                ? "Unique items are added exactly one per command."
                : "Positive whole number of stackable items to add."
            }
          />
        </label>
        <ActionButton intent="secondary" loading={pending} disabled={!selected} onClick={add}>
          Add
        </ActionButton>
      </div>
      <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
        {matches.length} of {catalog.length} items. Subject to the usual carried slot and mass
        limits.
      </p>
    </div>
  );
}

export function AdminInventoryTab({
  state,
  ...props
}: AdminTabProps & { state: AdminInspectorState }) {
  const { characterId, characterName, play, applyState, refreshAll, bus } = props;

  /**
   * Apply a command result. The returned authoritative state is always swapped
   * in; a real change also refreshes the audit, while a refusal or no-op
   * reports the server's message and leaves the audit alone.
   */
  async function settle<O extends { kind: string }>(
    response: { state: PlayGameplayState; outcome: O } | { error: string },
    changedKind: O["kind"],
    describe: (outcome: O) => string,
  ) {
    if ("error" in response) return bus(response.error, "danger");
    applyState(response.state);
    if (response.outcome.kind === changedKind) {
      await refreshAll();
      bus(describe(response.outcome), "success");
    } else {
      bus((response.outcome as { message?: string }).message ?? "Nothing changed.", "muted");
    }
  }

  async function removeCarried(stackId: string, mode: RemoveMode, expectedQuantity: number) {
    const response = await adminRemoveCarriedStackQuantity({
      characterId,
      stackId,
      mode,
      expectedQuantity,
    });
    await settle(response, "removed", (outcome) =>
      outcome.kind === "removed"
        ? `Removed ${outcome.removedQuantity} from carried (${outcome.source}).`
        : "",
    );
  }

  async function removeCargo(stackId: string, mode: RemoveMode, expectedQuantity: number) {
    const response = await adminRemoveCargoStackQuantity({
      characterId,
      stackId,
      mode,
      expectedQuantity,
    });
    await settle(response, "removed", (outcome) =>
      outcome.kind === "removed" ? `Removed ${outcome.removedQuantity} from Cargo.` : "",
    );
  }

  async function deleteUnique(itemInstanceId: string, where: "carried" | "Cargo") {
    const response = await adminDeleteUniqueItem({ characterId, itemInstanceId });
    await settle(response, "deleted", () =>
      where === "Cargo" ? "Unique item deleted from Cargo." : "Unique item deleted.",
    );
  }

  async function unequip(itemInstanceId: string) {
    const response = await adminForceUnequipItem({ characterId, itemInstanceId });
    await settle(response, "unequipped", () => "Item force-unequipped.");
  }

  const { inventory, equipment, cargoHold } = play;
  const repair = cargoHold.repair;

  return (
    <div className="space-y-4">
      <Section title="Carried inventory">
        <p className="text-xs text-[color:var(--rs-text-muted)]">
          {inventory.slotsUsed} used · {inventory.slotsAvailable} available · {inventory.massGrams}/
          {inventory.capacityGrams} g
        </p>
        {inventory.stacks.length === 0 && inventory.uniqueItems.length === 0 ? (
          <p className="text-sm text-[color:var(--rs-text-muted)]">Empty.</p>
        ) : (
          <ul className="space-y-2">
            {inventory.stacks.map((stack) => (
              <StackRow
                key={stack.id}
                stack={stack}
                testId="admin-carried-stack"
                scope={{
                  whole: `Remove the whole "${stack.name}" stack (${stack.quantity} × ${stack.itemId}) from "${characterName}"'s carried inventory.`,
                  one: `Remove 1 "${stack.name}" (${stack.itemId}) from "${characterName}"'s carried inventory.`,
                }}
                onRemove={removeCarried}
              />
            ))}
            {inventory.uniqueItems.map((item) => (
              <UniqueRow
                key={item.id}
                item={item}
                testId="admin-carried-unique"
                prompt={`Permanently delete the unique "${item.name}" (instance ${item.id}, ${item.itemId}) from "${characterName}"'s carried inventory.`}
                onDelete={(id) => deleteUnique(id, "carried")}
              />
            ))}
          </ul>
        )}
        <AddItemControl
          characterId={characterId}
          applyState={applyState}
          refreshAll={refreshAll}
          bus={bus}
        />
      </Section>

      <Section title="Equipment">
        <p className="text-xs text-[color:var(--rs-text-muted)]">
          Container slots: {equipment.aggregateContainerSlots}. FORCE UNEQUIP returns an item to
          carried inventory; an equipped unique must be unequipped before it can be deleted.
        </p>
        <ul className="space-y-2">
          {equipment.slots.map((slot) => {
            const item = slot.item;
            return (
              <li
                key={`${slot.target.assignmentKind}:${slot.target.suitSlotId}`}
                className={`flex flex-wrap items-center justify-between gap-2 ${listItemClass}`}
              >
                <span className="min-w-0">
                  <span className="block text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                    {slot.label}
                  </span>
                  {item ? (
                    <span className="text-[color:var(--rs-text-primary)]">{item.name}</span>
                  ) : (
                    <span className="text-[color:var(--rs-text-muted)]">empty</span>
                  )}
                  <span className="block break-all font-mono text-[10px] text-[color:var(--rs-text-muted)]">
                    {[
                      item ? `${item.itemId} · instance ${item.itemInstanceId}` : "",
                      `${slot.target.assignmentKind}:${slot.target.suitSlotId}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {item ? (
                  <ConfirmAction
                    label="Unequip"
                    confirmLabel="Force unequip"
                    intent="secondary"
                    prompt={`Force-unequip "${item.name}" (instance ${item.itemInstanceId}) from "${characterName}"'s ${slot.label} slot. If this is the Mining tool and a Mining action is live, that action will be stopped.`}
                    onConfirm={() => unequip(item.itemInstanceId)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
        {equipment.miningTool ? (
          <p className="text-xs text-[color:var(--rs-text-muted)]">
            {equipment.miningTool.name} charge {equipment.miningTool.currentCharge}/
            {equipment.miningTool.maximumCharge}
          </p>
        ) : null}
      </Section>

      <Section title="Cargo hold">
        <p className="text-xs text-[color:var(--rs-text-muted)]">
          {cargoHold.slotsUsed}/{cargoHold.capacitySlots} slots
          {repair.complete ? " · repair complete" : " · repair in progress"}
        </p>
        <p className="text-xs text-[color:var(--rs-text-muted)]">
          Repair is read-only here (player interaction owns it):{" "}
          {repair.materials
            .map((material) => `${material.name} ${material.contributed}/${material.required}`)
            .join(" · ")}{" "}
          · weld {repair.weldingProgress}
          {repair.completedAt ? ` · completed ${repair.completedAt}` : ""}. Stacks and stored unique
          items can be removed by exact identity.
        </p>
        {cargoHold.stacks.length === 0 && cargoHold.uniqueItems.length === 0 ? (
          <p className="text-sm text-[color:var(--rs-text-muted)]">Empty.</p>
        ) : (
          <ul className="space-y-2">
            {cargoHold.stacks.map((stack) => (
              <StackRow
                key={stack.id}
                stack={stack}
                testId="admin-cargo-stack"
                scope={{
                  whole: `Remove the whole Cargo stack "${stack.name}" (${stack.quantity} × ${stack.itemId}, stack ${stack.id}) from "${characterName}".`,
                  one: `Remove 1 "${stack.name}" (${stack.itemId}) from "${characterName}"'s Cargo hold.`,
                }}
                onRemove={removeCargo}
              />
            ))}
            {cargoHold.uniqueItems.map((item) => (
              <UniqueRow
                key={item.id}
                item={item}
                testId="admin-cargo-unique"
                prompt={`Permanently delete the unique "${item.name}" (instance ${item.id}, ${item.itemId}) stored in "${characterName}"'s Cargo hold.`}
                onDelete={(id) => deleteUnique(id, "Cargo")}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Unique item instances">
        <p className="text-xs text-[color:var(--rs-text-muted)]">
          Every occupied unique instance with its canonical item ID, instance ID, mutable state, and
          location (equipped slot / carried / Cargo).
        </p>
        {state.uniqueInstances.length === 0 ? (
          <p className="text-sm text-[color:var(--rs-text-muted)]">No unique item instances.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {state.uniqueInstances.map((instance) => (
              <li
                key={instance.instanceId}
                className="flex items-center justify-between gap-2"
                data-testid="admin-unique-instance"
              >
                <span className="text-[color:var(--rs-text-primary)]">
                  {itemLabel(instance.itemId)}
                  <span className="block break-all font-mono text-[10px] text-[color:var(--rs-text-muted)]">
                    {instance.itemId} · instance {instance.instanceId}
                  </span>
                </span>
                <span className="text-right text-[color:var(--rs-text-muted)]">
                  {instance.location}
                  {instance.currentCharge !== undefined
                    ? ` · charge ${instance.currentCharge}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
