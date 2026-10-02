"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { usePlay } from "@/features/play/PlayContext";
import {
  SITE_STASH_STORAGE_LABELS,
  projectSiteStashStorage,
} from "@/features/site-stash/site-stash-storage";
import type { StorageArea } from "@/features/storage/storage-selection";
import {
  StorageTransferSurface,
  type StorageTransferAdapter,
  type StorageTransferHooks,
} from "@/features/storage/StorageTransferSurface";
import { RepairWorkPanel } from "@/features/welding/RepairWorkPanel";
import {
  depositSiteStashStackAction,
  depositSiteStashUniqueItemAction,
  installSiteStashContainerAction,
  removeSiteStashContainerAction,
  swapSiteStashContainerAction,
  withdrawSiteStashStackAction,
  withdrawSiteStashUniqueItemAction,
  type SiteStashActionResult,
} from "@/server/actions";
import type { SiteStashContainerState, SiteStashState } from "@/server/play";

/**
 * A character's stash at the site they are standing in (#284).
 *
 * The server projects a stash only once it is meaningful to this character
 * (its Welding gate is met, or the mount is already built), so a character who
 * has not earned it never reaches this component with anything to render —
 * there is no locked teaser or disabled control to draw. This surface is three
 * stages of one thing: Build Stash Mount (the ordinary repair/Welding panel),
 * Install Container, and the built stash with the shared storage surface.
 *
 * Nothing here is authority. Which containers are offered, which swaps would
 * succeed and whether Remove is enabled all arrive pre-decided in the
 * projection, and every command re-proves location, ownership, mount and
 * capacity on the server.
 */
export function SiteStashPanel() {
  const { state } = usePlay();
  const stash = state.siteStash;
  if (!stash || state.travelState) return null;
  if (!stash.mountBuilt) {
    return (
      <RepairWorkPanel
        key={stash.repair.targetId}
        materialsPrompt="A permanent mount for a stash container, welded down at this site. Hand over the material you are carrying and bring the rest when you come back."
        targetId={stash.repair.targetId}
        title="Build Stash Mount"
        weldingPrompt="Everything is on hand. What is left is welding the mount down."
      />
    );
  }
  return <BuiltStash stash={stash} />;
}

function BuiltStash({ stash }: { stash: SiteStashState }) {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const [storageOpen, setStorageOpen] = useState(false);
  // Held here, not in the surface, so the phone view survives close and reopen.
  const [storageMode, setStorageMode] = useState<StorageArea>("carried");
  const [chooser, setChooser] = useState<"install" | "swap">();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  const busy = pending || foregroundBusy || Boolean(state.activeAction);
  const { container } = stash;

  /**
   * The shared command path: the foreground gate, pending state, feedback and
   * authoritative-state reconciliation. A refusal still carries fresh state, so
   * a stale view corrects itself.
   */
  function run(
    action: () => Promise<SiteStashActionResult>,
    success: string,
    hooks?: StorageTransferHooks,
  ) {
    enqueueForeground(() => {
      setPending(true);
      startTransition(async () => {
        try {
          const result = await action();
          if ("error" in result) {
            setMessage(result.error);
          } else {
            // Armed only on a confirmed non-error result, immediately before
            // the state that may vacate the selected tile is accepted.
            hooks?.armFocusReturn();
            acceptState(result.state);
            setMessage(result.stash.status === "committed" ? success : result.stash.message);
            if (result.stash.status === "committed") setChooser(undefined);
          }
        } catch {
          setMessage("Comms interruption. Stash status could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(false);
        }
      });
    });
  }

  const base = { characterId: state.characterId, locationId: stash.locationId };
  const transfers: StorageTransferAdapter = {
    depositStack: (input, hooks) =>
      run(() => depositSiteStashStackAction({ ...base, ...input }), "Stashed.", hooks),
    withdrawStack: (input, hooks) =>
      run(() => withdrawSiteStashStackAction({ ...base, ...input }), "Withdrawn.", hooks),
    depositUniqueItem: (input, hooks) =>
      run(() => depositSiteStashUniqueItemAction({ ...base, ...input }), "Stashed.", hooks),
    withdrawUniqueItem: (input, hooks) =>
      run(() => withdrawSiteStashUniqueItemAction({ ...base, ...input }), "Withdrawn.", hooks),
  };

  function installable(option: SiteStashContainerState) {
    return (
      <ActionButton
        data-stash-install-choice={option.itemInstanceId}
        disabled={busy}
        intent="secondary"
        key={option.itemInstanceId}
        onClick={() =>
          run(
            () =>
              installSiteStashContainerAction({ ...base, itemInstanceId: option.itemInstanceId }),
            `${option.name} installed.`,
          )
        }
      >
        {option.name} · {option.slotCapacity} slots
      </ActionButton>
    );
  }

  const swapChoices = stash.carriedContainers.filter((option) =>
    stash.swappableContainerInstanceIds.includes(option.itemInstanceId),
  );

  return (
    <ActivityPanel data-site-stash={stash.locationId} title="Site Stash">
      {!container ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <ActionButton
              data-stash-install
              disabled={busy || stash.carriedContainers.length === 0}
              intent="primary"
              onClick={() => setChooser((open) => (open === "install" ? undefined : "install"))}
            >
              Install Container
            </ActionButton>
          </div>
          <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
            {stash.carriedContainers.length === 0
              ? "The mount is built. Carry an unequipped container here to install it; its slot count becomes the stash's."
              : "Any container you carry and are not wearing will do. Its slot count becomes the stash's, and it leaves your Inventory while installed."}
          </p>
          {chooser === "install" ? (
            <div className="flex flex-wrap gap-2" data-stash-install-choices>
              {stash.carriedContainers.map(installable)}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-sm uppercase tracking-wide" data-stash-occupancy>
              {container.name} · {stash.slotsUsed} / {stash.capacitySlots} SLOTS OCCUPIED
            </p>
            <ActionButton
              data-stash-open
              intent="primary"
              onClick={() => setStorageOpen((open) => !open)}
            >
              {storageOpen ? "Close Stash" : "Stash"}
            </ActionButton>
          </div>
          <div className="flex flex-wrap gap-3">
            <ActionButton
              data-stash-swap
              disabled={busy || swapChoices.length === 0}
              intent="secondary"
              onClick={() => setChooser((open) => (open === "swap" ? undefined : "swap"))}
            >
              Swap Container
            </ActionButton>
            <ActionButton
              data-stash-remove
              disabled={busy || stash.removeBlockedReason !== undefined}
              intent="secondary"
              onClick={() =>
                run(
                  () =>
                    removeSiteStashContainerAction({
                      ...base,
                      expectedContainerInstanceId: container.itemInstanceId,
                    }),
                  `${container.name} removed.`,
                )
              }
            >
              Remove Container
            </ActionButton>
          </div>
          {stash.removeBlockedReason || swapChoices.length === 0 ? (
            <p
              className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]"
              data-stash-hint
            >
              {stash.removeBlockedReason === "not_empty"
                ? "A container can only be removed once the stash is empty. "
                : stash.removeBlockedReason === "carried_capacity"
                  ? "Make room in your Inventory to take the container back. "
                  : ""}
              {swapChoices.length === 0
                ? stash.carriedContainers.length > 0
                  ? "None of the containers you carry can replace it right now: a swap needs a different kind with room for everything stored here, and room in your Inventory for this one."
                  : "To swap, carry a different kind of container that is not equipped."
                : ""}
            </p>
          ) : null}
          {chooser === "swap" ? (
            <div className="flex flex-wrap gap-2" data-stash-swap-choices>
              {swapChoices.map((option) => (
                <ActionButton
                  data-stash-swap-choice={option.itemInstanceId}
                  disabled={busy}
                  intent="secondary"
                  key={option.itemInstanceId}
                  onClick={() =>
                    run(
                      () =>
                        swapSiteStashContainerAction({
                          ...base,
                          expectedContainerInstanceId: container.itemInstanceId,
                          itemInstanceId: option.itemInstanceId,
                        }),
                      `Swapped in ${option.name}. Everything stashed stayed put.`,
                    )
                  }
                >
                  {option.name} · {option.slotCapacity} slots
                </ActionButton>
              ))}
            </div>
          ) : null}
          {storageOpen ? (
            <div data-stash-storage>
              <StorageTransferSurface
                labels={SITE_STASH_STORAGE_LABELS}
                mode={storageMode}
                onModeChange={setStorageMode}
                onSelectItem={() => setMessage(undefined)}
                pending={pending}
                projection={projectSiteStashStorage(state, stash)}
                transfers={transfers}
              />
            </div>
          ) : null}
        </>
      )}
      {message ? <Feedback>{message}</Feedback> : null}
    </ActivityPanel>
  );
}
