"use client";

import { useState, useTransition, type RefObject } from "react";
import { ItemVisual } from "@/components/items/ItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { equipEquipmentAction, unequipEquipmentAction } from "@/server/actions";
import type { MiningGameplayState } from "@/server/mining";
import { useMiningPlay } from "./MiningPlayContext";

function kilograms(grams: number) {
  return `${(grams / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

export function EquipmentPanel({
  state,
  onClose,
  triggerRef,
}: {
  state: MiningGameplayState;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { commandInFlight, setState } = useMiningPlay();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();

  function apply(result: Awaited<ReturnType<typeof equipEquipmentAction>>) {
    if (result.error) {
      setMessage(result.error);
      return;
    }
    if (result.state) {
      setState(result.state);
      setMessage(undefined);
    }
  }

  function command(action: () => ReturnType<typeof equipEquipmentAction>) {
    if (commandInFlight.current) return;
    commandInFlight.current = true;
    startTransition(async () => {
      try {
        apply(await action());
      } catch {
        setMessage("Comms interruption. Equipment could not be confirmed.");
      } finally {
        commandInFlight.current = false;
      }
    });
  }

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
            {kilograms(state.inventory.massGrams)} / {kilograms(state.inventory.capacityGrams)}
          </strong>
        </p>
      </div>
      {message ? (
        <div className="mt-4">
          <Feedback tone="danger">{message}</Feedback>
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
                    {kilograms(slot.item.massGrams)}
                  </p>
                </div>
                <ActionButton
                  disabled={pending}
                  intent="secondary"
                  onClick={() =>
                    command(() =>
                      unequipEquipmentAction({
                        characterId: state.characterId,
                        target: slot.target,
                      }),
                    )
                  }
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
                        {kilograms(item.massGrams)}
                      </p>
                    </div>
                    <ActionButton
                      disabled={pending}
                      intent="mining"
                      onClick={() =>
                        command(() =>
                          equipEquipmentAction({
                            characterId: state.characterId,
                            itemInstanceId: item.itemInstanceId,
                            target: slot.target,
                          }),
                        )
                      }
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
