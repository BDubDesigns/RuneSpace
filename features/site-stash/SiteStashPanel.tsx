"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { getRepairTargetBalance } from "@/game/config/balance";
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
import { summarizeSiteStash } from "@/features/site-stash/site-stash-summary";
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
 * A stash is secondary to the site's own activity, so it is a compact
 * disclosure that sits below that activity and starts collapsed. The bar
 * always says the stage and the progress that matters; the full detail opens on
 * demand. Nothing here is authority. Which containers are offered, which swaps
 * would succeed and whether Remove is enabled all arrive pre-decided in the
 * projection, and every command re-proves location, ownership, mount and
 * capacity on the server.
 */
export function SiteStashPanel() {
  const { state } = usePlay();
  const stash = state.siteStash;
  if (!stash || state.travelState) return null;
  // Keyed by site, so moving between two sites never carries one's disclosure
  // state over to the other.
  return <SiteStashDisclosure key={stash.locationId} stash={stash} />;
}

const COMPLETION_NOTICE_DURATION_MS = 3_600;

function SiteStashDisclosure({ stash }: { stash: SiteStashState }) {
  const { state } = usePlay();
  const regionId = useId();
  const [expanded, setExpanded] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const previousBuilt = useRef(stash.mountBuilt);
  const summary = summarizeSiteStash(stash);
  const mountAction = getRepairTargetBalance(stash.repair.targetId).actionId;
  // The mount's own Welding is running: its Stop control and its time-sensitive
  // Clean Pass must never be hidden behind a collapsed bar.
  const welding = !stash.mountBuilt && state.activeAction?.actionId === mountAction;

  // Welding brings the detail open and it stays open afterwards, so pressing
  // Stop does not make the panel the player was just using vanish.
  useEffect(() => {
    if (welding) setExpanded(true);
  }, [welding]);

  // The construction panel unmounts the moment the mount is built, taking its
  // local completion feedback with it, so the completion is announced here, and
  // the detail folds back to the compact bar the finished stash lives in.
  useEffect(() => {
    const wasBuilt = previousBuilt.current;
    previousBuilt.current = stash.mountBuilt;
    if (wasBuilt || !stash.mountBuilt) return;
    setExpanded(false);
    setNoticeVisible(true);
    setAnnouncement("Stash Mount built. Install a container to start using it.");
    const timer = window.setTimeout(() => setNoticeVisible(false), COMPLETION_NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [stash.mountBuilt]);

  const open = expanded || welding;

  return (
    <section data-site-stash-disclosure={stash.locationId} data-stash-stage={summary.stage}>
      <p aria-live="polite" className="sr-only" data-site-stash-announcement>
        {announcement}
      </p>
      <button
        aria-controls={regionId}
        aria-expanded={open}
        className="rs-focus flex min-h-[var(--rs-touch-target)] w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-70"
        data-site-stash-toggle
        disabled={welding}
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span className="font-display text-sm font-bold uppercase tracking-[0.16em] text-[color:var(--rs-text-primary)]">
          {summary.label}
        </span>
        <span
          className="min-w-0 flex-1 text-sm text-[color:var(--rs-text-secondary)]"
          data-site-stash-summary
        >
          {summary.detail}
        </span>
        <span
          aria-hidden="true"
          className="font-display text-xs uppercase tracking-wide text-[color:var(--rs-accent-primary)]"
        >
          {welding ? "Welding" : open ? "Hide" : "Show"}
        </span>
      </button>
      {noticeVisible ? (
        <p
          className="rs-result-feedback-success mt-2 border border-[color:var(--rs-accent-success)] bg-[color:var(--rs-surface-panel)] p-3 font-display text-sm uppercase tracking-wide"
          data-site-stash-notice
        >
          Stash Mount built — install a container to start using it.
        </p>
      ) : null}
      <div className="mt-2" hidden={!open} id={regionId}>
        {open ? (
          stash.mountBuilt ? (
            <BuiltStash stash={stash} />
          ) : (
            <RepairWorkPanel
              key={stash.repair.targetId}
              materialsPrompt="A permanent mount for a stash container, welded down at this site. Hand over the material you are carrying and bring the rest when you come back."
              targetId={stash.repair.targetId}
              title="Build Stash Mount"
              weldingPrompt="Everything is on hand. What is left is welding the mount down."
            />
          )
        ) : null}
      </div>
    </section>
  );
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
