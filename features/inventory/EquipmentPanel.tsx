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
import { EquipmentToolDetails } from "./EquipmentToolDetails";
import {
  CandidateThumbnail,
  PlaceholderTile,
  PowerCellTile,
  SlotTile,
} from "./EquipmentLoadoutTiles";
import {
  FUTURE_SLOT_PLACEHOLDERS,
  candidateBlockedReasons,
  deriveLoadoutCells,
  derivePowerCellUtility,
  equipmentSlotKey,
  placeholderKey,
  resolveSelectedCandidate,
  resolveSelectedSlot,
  type EquipmentCandidate,
  type EquipmentSlotState,
} from "./equipment-loadout";

function itemFacts(item: { massGrams: number; slotCapacity?: number }) {
  return (
    <>
      {formatMassGrams(item.massGrams)}
      {item.slotCapacity !== undefined ? ` · +${item.slotCapacity} Inventory slots` : ""}
    </>
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
  const [pendingFocusKey, setPendingFocusKey] = useState<string>();
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
      setPendingFocusKey(selectedKey);
    },
  );
  const miningToolSlotId = getEffectiveGameBalance().carrying.miningToolSuitSlotId;
  const cells = deriveLoadoutCells(state.equipment.slots, miningToolSlotId);
  const powerCellUtility = derivePowerCellUtility(state.equipment);
  const slot = resolveSelectedSlot(state.equipment.slots, selectedKey);
  const candidate = resolveSelectedCandidate(slot, candidateId);
  const placeholder = FUTURE_SLOT_PLACEHOLDERS.map(({ id, label }) => ({
    key: placeholderKey(id),
    label,
  })).find(({ key }) => key === selectedKey);
  const tool = state.equipment.miningTool;
  // Mission guidance is consumed from the ONE derived target set: while an
  // equipped-item requirement is the current unmet step, the matching item's
  // equip affordance receives the treatment. No mission-ID branching here.
  const missionGuidanceTargets = derivePinnedGuidanceTargets(state);

  // Opening a slot's details moves focus to them so a keyboard or screen-reader
  // player lands on what they asked for; collapsing leaves focus on the tile.
  useEffect(() => {
    if (!focusDetailsOnOpen.current || !(slot || placeholder)) return;
    focusDetailsOnOpen.current = false;
    detailsRef.current?.focus();
  }, [slot, placeholder?.key]);

  // Focus returns to the slot tile only after the confirmed state has rendered,
  // so it lands on the new (re-artworked) tile rather than one being replaced.
  useEffect(() => {
    if (!pendingFocusKey) return;
    focusSlotTile(pendingFocusKey);
    setPendingFocusKey(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocusKey, state.equipment.slots]);

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
        {cells.map((cell) => (
          <div
            className="flex min-w-0 flex-col"
            data-equipment-slot={cell.key}
            data-slot-label={cell.kind === "slot" ? cell.slot.label : undefined}
            data-slot-state={
              cell.kind === "slot" ? (cell.slot.item ? "occupied" : "empty") : cell.kind
            }
            key={cell.key}
          >
            {cell.kind === "slot" ? (
              <SlotTile
                icon={cell.icon}
                onSelect={() => selectSlot(cell.key)}
                selected={cell.key === selectedKey}
                shortLabel={cell.shortLabel}
                slot={cell.slot}
              />
            ) : cell.kind === "placeholder" ? (
              <PlaceholderTile
                icon={cell.icon}
                label={cell.label}
                onSelect={() => selectSlot(cell.key)}
                selected={cell.key === selectedKey}
              />
            ) : (
              <PowerCellTile
                busy={foregroundBusy}
                loading={loadBusy}
                onLoad={loadPowerCell}
                utility={powerCellUtility}
              />
            )}
          </div>
        ))}
      </div>
      {placeholder ? (
        <section
          aria-label={`${placeholder.label} details`}
          className="mt-4 border border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-surface-panel)] p-3 outline-none"
          data-equipment-details={placeholder.key}
          ref={detailsRef}
          tabIndex={-1}
        >
          <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
            {placeholder.label} · Coming soon
          </p>
          <p className="mt-2 text-sm text-[color:var(--rs-text-muted)]">
            No {placeholder.label.toLowerCase()} exist yet, so this slot cannot hold or equip
            anything.
          </p>
          {messageNode}
        </section>
      ) : slot ? (
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
                        className={`rs-focus min-h-[var(--rs-touch-target)] w-full border px-2 py-2 text-left text-sm ${selected ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)]" : "border-[color:var(--rs-border-structural)]"} ${blocked ? "border-dashed text-[color:var(--rs-text-muted)]" : "text-[color:var(--rs-text-secondary)]"}`}
                        data-candidate={item.itemInstanceId}
                        data-candidate-state={blocked ? "blocked" : "available"}
                        onClick={() => setCandidateId(selected ? undefined : item.itemInstanceId)}
                        type="button"
                      >
                        <span className="flex items-center gap-3">
                          <CandidateThumbnail candidate={item} />
                          <span className="min-w-0 flex-1">
                            <strong className="block">{item.name}</strong>
                            <span className="block text-xs">{itemFacts(item)}</span>
                          </span>
                          <span className="shrink-0 text-xs uppercase tracking-wide">
                            {blocked ? "Blocked" : "Available"}
                          </span>
                        </span>
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
