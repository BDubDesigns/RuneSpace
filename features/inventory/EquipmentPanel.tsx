"use client";

import { useState, type RefObject } from "react";
import { ItemVisual } from "@/components/items/ItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { GAME_TICK_MS } from "@/game/config/foundations";
import { formatMassGrams } from "@/game/domain/mass";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";
import type { PlayGameplayState } from "@/server/play";
import { useEquipCommand } from "./useEquipCommand";
import { useLoadPowerCell } from "@/features/mining/useLoadPowerCell";
import { usePlay } from "@/features/play/PlayContext";

function secondsForTicks(ticks: number) {
  return (ticks * GAME_TICK_MS) / 1_000;
}

export function EquipmentPanel({
  state,
  onClose,
  triggerRef,
}: {
  state: PlayGameplayState;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { foregroundBusy } = usePlay();
  const [message, setMessage] = useState<string>();
  const [messageTone, setMessageTone] = useState<"muted" | "danger">("muted");
  const { busy: loadBusy, loadPowerCell } = useLoadPowerCell((feedback) => {
    setMessage(feedback.message);
    setMessageTone(feedback.tone);
  });
  const { equip, unequip } = useEquipCommand((feedback) => {
    setMessage(feedback.tone === "muted" ? undefined : feedback.message);
    setMessageTone(feedback.tone);
  });
  const miningToolSlotId = getEffectiveGameBalance().items.salvageCutter.suitSlotId;
  // Mission guidance is consumed from the ONE derived target set: while an
  // equipped-item requirement is the current unmet step, the matching item's
  // equip affordance receives the treatment. No mission-ID branching here.
  const missionGuidanceTargets = deriveMissionGuidanceTargets(state.missions);

  return (
    <Drawer
      eyebrow="Server-confirmed loadout"
      label="Equipment"
      onClose={onClose}
      title="Equipment"
      triggerRef={triggerRef}
    >
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
      {message ? (
        <div className="mt-4">
          <Feedback tone={messageTone}>{message}</Feedback>
        </div>
      ) : null}
      <div className="mt-4 space-y-4">
        {state.equipment.slots.map((slot) => (
          <section
            aria-label={slot.label}
            className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
            key={`${slot.target.assignmentKind}:${slot.target.suitSlotId}`}
          >
            <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
              {slot.label}
            </p>
            {slot.item ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                  <ItemVisual
                    accessibleLabel={`${slot.item.name} equipped`}
                    badge="Equipped"
                    itemId={slot.item.itemId}
                    name={slot.item.name}
                  />
                  <p className="self-end text-sm text-[color:var(--rs-text-secondary)]">
                    {slot.item.name}
                    <br />
                    {formatMassGrams(slot.item.massGrams)}
                  </p>
                </div>
                {slot.target.assignmentKind === "gear" &&
                slot.target.suitSlotId === miningToolSlotId &&
                state.equipment.salvageCutter ? (
                  <div className="border-t border-[color:var(--rs-border-subtle)] pt-3 sm:col-span-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
                        Power Cell charge
                      </p>
                      <p className="text-sm text-[color:var(--rs-text-secondary)]">
                        {state.equipment.salvageCutter.currentCharge > 0
                          ? "Loaded · "
                          : "Depleted · "}
                        {state.equipment.salvageCutter.currentCharge} /{" "}
                        {state.equipment.salvageCutter.maximumCharge}
                      </p>
                    </div>
                    <div className="mt-2">
                      <StatusMeter
                        label="Boosted attempts"
                        value={
                          (state.equipment.salvageCutter.currentCharge /
                            state.equipment.salvageCutter.maximumCharge) *
                          100
                        }
                        detail={`${state.equipment.salvageCutter.currentCharge} remaining`}
                      />
                    </div>
                    <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
                      Boosted attempt: {state.equipment.salvageCutter.boostedAttemptDurationTicks}{" "}
                      ticks /{" "}
                      {secondsForTicks(state.equipment.salvageCutter.boostedAttemptDurationTicks)}{" "}
                      seconds
                    </p>
                    <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
                      Carried Power Cells: {state.equipment.carriedPowerCellQuantity}
                    </p>
                    {state.equipment.salvageCutter.currentCharge > 0 ? (
                      <Feedback>
                        Power Cell already loaded — {state.equipment.salvageCutter.currentCharge}{" "}
                        boosted attempts remain.
                      </Feedback>
                    ) : state.equipment.carriedPowerCellQuantity > 0 ? (
                      <ActionButton
                        className="mt-3"
                        disabled={foregroundBusy}
                        intent="mining"
                        loading={loadBusy}
                        onClick={loadPowerCell}
                      >
                        Load Power Cell
                      </ActionButton>
                    ) : (
                      <Feedback>No loose Power Cells are carried.</Feedback>
                    )}
                  </div>
                ) : null}
                <ActionButton
                  disabled={foregroundBusy}
                  intent="secondary"
                  onClick={() => unequip(slot.target, "")}
                >
                  Unequip
                </ActionButton>
              </div>
            ) : (
              <p className="mt-2 text-sm text-[color:var(--rs-text-muted)]">Empty</p>
            )}
            {slot.eligibleItems.length ? (
              <div className="mt-3 space-y-3 border-t border-[color:var(--rs-border-subtle)] pt-3">
                <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                  Eligible owned items
                </p>
                {slot.eligibleItems.map((item) => (
                  <div
                    className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                    key={item.itemInstanceId}
                  >
                    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                      <ItemVisual
                        accessibleLabel={`${item.name}, available to equip`}
                        badge="Available"
                        itemId={item.itemId}
                        name={item.name}
                      />
                      <p className="self-end text-sm text-[color:var(--rs-text-secondary)]">
                        {item.name}
                        <br />
                        {formatMassGrams(item.massGrams)}
                      </p>
                    </div>
                    <ActionButton
                      className={
                        missionGuidanceTargets.equipmentItemIds.has(item.itemId)
                          ? "rs-mission-guidance"
                          : undefined
                      }
                      data-mission-guidance={
                        missionGuidanceTargets.equipmentItemIds.has(item.itemId)
                          ? "active"
                          : undefined
                      }
                      disabled={foregroundBusy}
                      intent="mining"
                      onClick={() => equip(item.itemInstanceId, slot.target, "")}
                    >
                      Equip in {slot.label}
                    </ActionButton>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </Drawer>
  );
}
