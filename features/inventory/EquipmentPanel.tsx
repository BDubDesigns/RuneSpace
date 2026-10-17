"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ItemVisual } from "@/components/items/ItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { formatMassGrams } from "@/game/domain/mass";
import { derivePinnedGuidanceTargets } from "@/features/missions/mission-pins";
import type { PlayGameplayState } from "@/server/play";
import { useEquipCommand } from "./useEquipCommand";
import { useLoadPowerCell } from "@/features/mining/useLoadPowerCell";
import { usePlay } from "@/features/play/PlayContext";
import { EquipmentSlotIcon } from "./EquipmentSlotIcon";
import { EquipmentToolDetails } from "./EquipmentToolDetails";
import {
  candidateBlockedReasons,
  deriveLoadoutTiles,
  equipmentSlotKey,
  resolveSelectedCandidate,
  resolveSelectedSlot,
  type EquipmentCandidate,
  type EquipmentSlotState,
  type LoadoutTile,
} from "./equipment-loadout";

const SELECTION_ACCENT = "var(--rs-accent-primary)";

function itemFacts(item: { massGrams: number; slotCapacity?: number }) {
  return (
    <>
      {formatMassGrams(item.massGrams)}
      {item.slotCapacity !== undefined ? ` · +${item.slotCapacity} Inventory slots` : ""}
    </>
  );
}

function SlotTile({
  tile,
  selected,
  onSelect,
}: {
  tile: LoadoutTile;
  selected: boolean;
  onSelect: () => void;
}) {
  const { slot } = tile;
  const available = slot.eligibleItems.length;
  return (
    <div
      className={tile.span === 2 ? "col-span-2" : undefined}
      data-equipment-slot={tile.key}
      data-slot-state={slot.item ? "occupied" : "empty"}
    >
      <p className="mb-1 font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
        {slot.label}
      </p>
      {slot.item ? (
        <ItemVisual
          accessibleLabel={`${slot.label}: ${slot.item.name}, equipped`}
          interactive
          itemId={slot.item.itemId}
          name={slot.item.name}
          onSelect={onSelect}
          selected={selected}
          selectionAccent={SELECTION_ACCENT}
        />
      ) : (
        <button
          aria-label={`${slot.label}: empty${available ? `, ${available} compatible ${available === 1 ? "item" : "items"} carried` : ""}`}
          aria-pressed={selected}
          className={`rs-focus flex min-h-28 w-full cursor-pointer flex-col items-center justify-center gap-1 border border-dashed border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] p-3 text-[color:var(--rs-text-muted)] ${selected ? "ring-2 ring-[color:var(--rs-accent-primary)]" : ""}`}
          onClick={onSelect}
          type="button"
        >
          <EquipmentSlotIcon kind={tile.icon} />
          <span className="text-xs uppercase tracking-wide">
            {available ? `Empty · ${available} available` : "Empty"}
          </span>
        </button>
      )}
    </div>
  );
}

function CandidateDetails({
  candidate,
  slot,
  guided,
  busy,
  onEquip,
}: {
  candidate: EquipmentCandidate;
  slot: EquipmentSlotState;
  guided: boolean;
  busy: boolean;
  onEquip: () => void;
}) {
  const reasons = candidateBlockedReasons(candidate);
  return (
    <div
      className="mt-3 grid grid-cols-[7rem_minmax(0,1fr)] gap-3"
      data-candidate-details={candidate.itemInstanceId}
    >
      <ItemVisual itemId={candidate.itemId} name={candidate.name} />
      <div className="min-w-0 space-y-2 text-sm text-[color:var(--rs-text-secondary)]">
        <p>
          <strong>{candidate.name}</strong>
          <br />
          {itemFacts(candidate)}
        </p>
        {reasons.length ? (
          <ul className="space-y-1" data-equip-blocked>
            {reasons.map((reason) => (
              <li
                className="text-[color:var(--rs-accent-danger)]"
                data-equip-blocked-reason
                key={reason}
              >
                Cannot equip: {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p>Ready to equip in {slot.label}.</p>
        )}
        <MissionActionButton
          disabled={busy || reasons.length > 0}
          guidance={guided && reasons.length === 0 ? "active" : undefined}
          intent="mining"
          onClick={onEquip}
        >
          Equip in {slot.label}
        </MissionActionButton>
      </div>
    </div>
  );
}

export function EquipmentPanel({
  state,
  onClose,
  triggerRef,
  embedded = false,
}: {
  state: PlayGameplayState;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  embedded?: boolean;
}) {
  const { foregroundBusy } = usePlay();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [candidateId, setCandidateId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [messageTone, setMessageTone] = useState<"muted" | "danger">("muted");
  const gridRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const focusDetailsOnOpen = useRef(false);
  const { busy: loadBusy, loadPowerCell } = useLoadPowerCell((feedback) => {
    setMessage(feedback.message);
    setMessageTone(feedback.tone);
  });
  const focusSlotTile = (key: string) =>
    gridRef.current?.querySelector<HTMLElement>(`[data-equipment-slot="${key}"] button`)?.focus();
  const { equip, unequip } = useEquipCommand(
    (feedback) => {
      setMessage(feedback.message || undefined);
      setMessageTone(feedback.tone);
    },
    // Confirmed only: the equipped candidate left the list, so its selection is
    // stale. The slot stays selected and keeps focus on its (re-artworked) tile.
    () => {
      setCandidateId(undefined);
      if (selectedKey) requestAnimationFrame(() => focusSlotTile(selectedKey));
    },
  );
  const miningToolSlotId = getEffectiveGameBalance().carrying.miningToolSuitSlotId;
  const tiles = deriveLoadoutTiles(state.equipment.slots, miningToolSlotId);
  const slot = resolveSelectedSlot(state.equipment.slots, selectedKey);
  const candidate = resolveSelectedCandidate(slot, candidateId);
  const tool = state.equipment.miningTool;
  // Mission guidance is consumed from the ONE derived target set: while an
  // equipped-item requirement is the current unmet step, the matching item's
  // equip affordance receives the treatment. No mission-ID branching here.
  const missionGuidanceTargets = derivePinnedGuidanceTargets(state);

  // Opening a slot's details moves focus to them so a keyboard or screen-reader
  // player lands on what they asked for; collapsing leaves focus on the tile.
  useEffect(() => {
    if (!focusDetailsOnOpen.current || !slot) return;
    focusDetailsOnOpen.current = false;
    detailsRef.current?.focus();
  }, [slot]);

  const selectSlot = (key: string) => {
    setCandidateId(undefined);
    setMessage(undefined);
    if (key === selectedKey) {
      setSelectedKey(undefined);
      return;
    }
    focusDetailsOnOpen.current = true;
    setSelectedKey(key);
  };

  const messageNode = message ? (
    <div aria-live="polite">
      <Feedback tone={messageTone}>{message}</Feedback>
    </div>
  ) : null;

  const content = (
    <>
      {embedded ? (
        <p className="mt-4 text-xs uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)]">
          Server-confirmed loadout
        </p>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <p>
          <span className="block text-[color:var(--rs-text-muted)]">Container capacity</span>
          <strong>{state.equipment.aggregateContainerSlots} slots</strong>
        </p>
        <p>
          <span className="block text-[color:var(--rs-text-muted)]">Carried mass</span>
          <strong>
            {formatMassGrams(state.inventory.massGrams)} /{" "}
            {formatMassGrams(state.inventory.capacityGrams)}
          </strong>
        </p>
      </div>
      <div
        aria-label="Equipment loadout"
        className="mt-4 grid grid-cols-2 gap-3"
        ref={gridRef}
        role="group"
      >
        {tiles.map((tile) => (
          <SlotTile
            key={tile.key}
            onSelect={() => selectSlot(tile.key)}
            selected={tile.key === selectedKey}
            tile={tile}
          />
        ))}
      </div>
      {slot ? (
        <section
          aria-label={`${slot.label} details`}
          className="mt-4 border border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-surface-panel)] p-3 outline-none"
          data-equipment-details={equipmentSlotKey(slot.target)}
          ref={detailsRef}
          tabIndex={-1}
        >
          <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
            {slot.label}
          </p>
          {slot.item ? (
            <div className="mt-2 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[color:var(--rs-text-secondary)]">
                  <strong>{slot.item.name}</strong> · Equipped
                  <br />
                  {itemFacts(slot.item)}
                </p>
                <ActionButton
                  disabled={foregroundBusy}
                  intent="secondary"
                  onClick={() => unequip(slot.target, `${slot.item?.name} unequipped.`)}
                >
                  Unequip
                </ActionButton>
              </div>
              {slot.target.assignmentKind === "gear" &&
              slot.target.suitSlotId === miningToolSlotId &&
              tool ? (
                <EquipmentToolDetails
                  carriedPowerCellQuantity={state.equipment.carriedPowerCellQuantity}
                  loadBusy={loadBusy}
                  loadDisabled={foregroundBusy}
                  onLoadPowerCell={loadPowerCell}
                  tool={tool}
                />
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-[color:var(--rs-text-muted)]">Empty</p>
          )}
          <div className="mt-3 border-t border-[color:var(--rs-border-subtle)] pt-3">
            <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
              Carried items that fit {slot.label}
            </p>
            {slot.eligibleItems.length ? (
              <ul className="mt-2 space-y-2">
                {slot.eligibleItems.map((item) => {
                  const blocked = candidateBlockedReasons(item).length > 0;
                  const selected = item.itemInstanceId === candidate?.itemInstanceId;
                  return (
                    <li key={item.itemInstanceId}>
                      <button
                        aria-pressed={selected}
                        className={`rs-focus min-h-[var(--rs-touch-target)] w-full border px-3 py-2 text-left text-sm ${selected ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)]" : "border-[color:var(--rs-border-structural)]"} ${blocked ? "border-dashed text-[color:var(--rs-text-muted)]" : "text-[color:var(--rs-text-secondary)]"}`}
                        data-candidate={item.itemInstanceId}
                        data-candidate-state={blocked ? "blocked" : "available"}
                        onClick={() => setCandidateId(selected ? undefined : item.itemInstanceId)}
                        type="button"
                      >
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <strong>{item.name}</strong>
                          <span className="text-xs uppercase tracking-wide">
                            {blocked ? "Blocked" : "Available"}
                          </span>
                        </span>
                        <span className="block text-xs">{itemFacts(item)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[color:var(--rs-text-muted)]">
                No other carried item fits this slot.
              </p>
            )}
            {candidate ? (
              <CandidateDetails
                busy={foregroundBusy}
                candidate={candidate}
                guided={missionGuidanceTargets.equipmentItemIds.has(candidate.itemId)}
                onEquip={() =>
                  equip(candidate.itemInstanceId, slot.target, `${candidate.name} equipped.`)
                }
                slot={slot}
              />
            ) : null}
          </div>
          {messageNode}
        </section>
      ) : (
        messageNode
      )}
    </>
  );

  if (embedded) return content;
  return (
    <Drawer
      eyebrow="Server-confirmed loadout"
      label="Equipment"
      onClose={onClose}
      title="Equipment"
      triggerRef={triggerRef}
    >
      {content}
    </Drawer>
  );
}
