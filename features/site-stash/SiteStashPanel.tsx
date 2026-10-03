"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { getRepairTargetBalance } from "@/game/config/balance";
import { ItemVisual } from "@/components/items/ItemVisual";
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
 * there is no locked teaser or disabled control to draw.
 *
 * It is ONE panel: the compact bar is its header, and under the bar is the one
 * thing the current stage needs — the Build Stash Mount work, then a visible
 * choice of container to install, then the shared storage surface. A stash is
 * secondary to the site's own activity, so it sits below that activity and
 * starts collapsed. Nothing here is authority. Which containers are offered,
 * which swaps would succeed and whether Remove is enabled all arrive
 * pre-decided in the projection, and every command re-proves location,
 * ownership, mount and capacity on the server.
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
const SCROLL_MARGIN = "scroll-mt-[calc(env(safe-area-inset-top)+var(--rs-space-3))]";
const SECTION_HEADING =
  "font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]";
const HINT = "max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]";

/**
 * Bring newly shown content into view, but only when the player asked for it.
 *
 * Mining alone can fill a phone screen, so content opened at the bottom would
 * appear below the fold and the tap would look ineffective. `requestReveal` is
 * called from the player's own action; once React has rendered the result (the
 * `token` changed while `enabled`) the target is scrolled to the top edge,
 * leaving a long panel to scroll normally and the fixed bottom navigation clear
 * of its start. Initial mount, background refreshes, Welding opening the detail
 * by itself and collapsing never request it, so none of them move the page.
 */
function useReveal<T extends HTMLElement>(token: string, enabled = true) {
  const target = useRef<T>(null);
  const requested = useRef(false);
  useEffect(() => {
    if (!enabled || !requested.current) return;
    requested.current = false;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.current?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  }, [token, enabled]);
  return {
    target,
    requestReveal: () => {
      requested.current = true;
    },
  };
}

function SiteStashDisclosure({ stash }: { stash: SiteStashState }) {
  const { state } = usePlay();
  const regionId = useId();
  const titleId = useId();
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

  // The construction work unmounts the moment the mount is built, taking its
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
  // Opening, and installing a container (which swaps the choice for storage in
  // this same panel), keep the panel's start on screen.
  const reveal = useReveal<HTMLElement>(`${open}:${stash.container?.itemInstanceId ?? ""}`, open);

  return (
    <section
      className={`${SCROLL_MARGIN} border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)]`}
      data-site-stash-disclosure={stash.locationId}
      data-stash-stage={summary.stage}
      ref={reveal.target}
    >
      <p aria-live="polite" className="sr-only" data-site-stash-announcement>
        {announcement}
      </p>
      <button
        aria-controls={regionId}
        aria-expanded={open}
        className="rs-focus block min-h-[var(--rs-touch-target)] w-full px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-70"
        data-site-stash-toggle
        disabled={welding}
        onClick={() => {
          if (!open) reveal.requestReveal();
          setExpanded(!open);
        }}
        type="button"
      >
        {/* Two intentional rows: the title and its control share the first, and
            the summary, however long, takes the whole second. The summary never
            decides where the control lands. */}
        <span className="flex items-center justify-between gap-3">
          <span
            className="min-w-0 font-display text-sm font-bold uppercase tracking-[0.16em] text-[color:var(--rs-text-primary)]"
            data-site-stash-title
            id={titleId}
          >
            {summary.label}
          </span>
          <span
            aria-hidden="true"
            className="shrink-0 font-display text-xs uppercase tracking-wide text-[color:var(--rs-accent-primary)]"
            data-site-stash-indicator
          >
            {welding ? "Welding" : open ? "Hide" : "Show"}
          </span>
        </span>
        <span
          className="mt-1 block text-sm text-[color:var(--rs-text-secondary)]"
          data-site-stash-summary
        >
          {summary.detail}
        </span>
      </button>
      {noticeVisible ? (
        <p
          className="rs-result-feedback-success mx-3 mb-3 border border-[color:var(--rs-accent-success)] bg-[color:var(--rs-surface-panel)] p-3 font-display text-sm uppercase tracking-wide"
          data-site-stash-notice
        >
          Stash Mount built — install a container to start using it.
        </p>
      ) : null}
      <div
        aria-labelledby={titleId}
        className="border-t border-[color:var(--rs-border-subtle)] p-3"
        hidden={!open}
        id={regionId}
        role="region"
      >
        {open ? (
          stash.mountBuilt ? (
            <BuiltStash onInstalled={reveal.requestReveal} stash={stash} />
          ) : (
            <RepairWorkPanel
              embedded
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

type StashFeedback = { tone: "success" | "danger"; text: string };

/**
 * The contents of a built stash: choose a container to install, or — once one
 * is installed — the shared storage surface, with the rarely used Swap and
 * Remove behind a quiet management disclosure at the foot.
 */
function BuiltStash({ onInstalled, stash }: { onInstalled: () => void; stash: SiteStashState }) {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  // Held here, not in the surface, so the phone view survives a mode switch.
  const [storageMode, setStorageMode] = useState<StorageArea>("carried");
  const [feedback, setFeedback] = useState<StashFeedback>();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  const busy = pending || foregroundBusy || Boolean(state.activeAction);
  const { container } = stash;

  // A confirmation is passing information (the header already proves the
  // result), so it goes away by itself; a refusal or failure stays until the
  // player's next action.
  useEffect(() => {
    if (feedback?.tone !== "success") return;
    const timer = window.setTimeout(() => setFeedback(undefined), COMPLETION_NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  /**
   * The shared command path: the foreground gate, pending state, feedback and
   * authoritative-state reconciliation. A refusal still carries fresh state, so
   * a stale view corrects itself. Nothing is confirmed before the server says so.
   */
  function run(
    action: () => Promise<SiteStashActionResult>,
    success: string,
    options?: { hooks?: StorageTransferHooks; revealPanel?: boolean },
  ) {
    enqueueForeground(() => {
      setPending(true);
      startTransition(async () => {
        try {
          const result = await action();
          if ("error" in result) {
            setFeedback({ tone: "danger", text: result.error });
          } else {
            // Armed only on a confirmed non-error result, immediately before
            // the state that may vacate the selected tile is accepted.
            options?.hooks?.armFocusReturn();
            if (result.stash.status === "committed") {
              if (options?.revealPanel) onInstalled();
              acceptState(result.state);
              setFeedback({ tone: "success", text: success });
            } else {
              acceptState(result.state);
              setFeedback({ tone: "danger", text: result.stash.message });
            }
          }
        } catch {
          setFeedback({
            tone: "danger",
            text: "Comms interruption. Stash status could not be confirmed.",
          });
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
      run(() => depositSiteStashStackAction({ ...base, ...input }), "Stashed.", { hooks }),
    withdrawStack: (input, hooks) =>
      run(() => withdrawSiteStashStackAction({ ...base, ...input }), "Withdrawn.", { hooks }),
    depositUniqueItem: (input, hooks) =>
      run(() => depositSiteStashUniqueItemAction({ ...base, ...input }), "Stashed.", { hooks }),
    withdrawUniqueItem: (input, hooks) =>
      run(() => withdrawSiteStashUniqueItemAction({ ...base, ...input }), "Withdrawn.", { hooks }),
  };

  return (
    <div data-site-stash={stash.locationId}>
      {!container ? (
        <div className="space-y-3" data-stash-choose>
          <h3 className={SECTION_HEADING}>Choose a container</h3>
          {stash.carriedContainers.length === 0 ? (
            <p className={HINT} data-stash-hint>
              The mount is built. Carry an unequipped container here to install it; its slot count
              becomes the stash&apos;s.
            </p>
          ) : (
            <>
              <ContainerChoice
                busy={busy}
                cardAttribute="data-stash-container-card"
                confirmAttribute="data-stash-install-confirm"
                confirmLabel="Install selected container"
                groupLabel="Containers you can install"
                onConfirm={(itemInstanceId) =>
                  run(
                    () => installSiteStashContainerAction({ ...base, itemInstanceId }),
                    `${stash.carriedContainers.find((option) => option.itemInstanceId === itemInstanceId)?.name ?? "Container"} installed.`,
                    { revealPanel: true },
                  )
                }
                options={stash.carriedContainers}
              />
              <p className={HINT}>
                Any container you carry and are not wearing will do. Its slot count becomes the
                stash&apos;s, and it leaves your Inventory while installed.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div data-stash-storage>
            <StorageTransferSurface
              labels={SITE_STASH_STORAGE_LABELS}
              mode={storageMode}
              onModeChange={setStorageMode}
              onSelectItem={() => setFeedback(undefined)}
              pending={pending}
              projection={projectSiteStashStorage(state, stash)}
              transfers={transfers}
            />
          </div>
          <ContainerManagement
            base={base}
            busy={busy}
            container={container}
            run={run}
            stash={stash}
          />
        </>
      )}
      {feedback ? (
        <div data-stash-feedback>
          <Feedback tone={feedback.tone}>{feedback.text}</Feedback>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Real, selectable containers rather than a bare button: each is the item's own
 * approved presentation with its slot count, a card only selects, and the
 * command is a separate, explicit action. With exactly one candidate it starts
 * selected, so the common case is a single confirm.
 */
function ContainerChoice({
  busy,
  cardAttribute,
  confirmAttribute,
  confirmLabel,
  groupLabel,
  onConfirm,
  options,
}: {
  busy: boolean;
  cardAttribute: string;
  confirmAttribute: string;
  confirmLabel: string;
  groupLabel: string;
  onConfirm: (itemInstanceId: string) => void;
  options: readonly SiteStashContainerState[];
}) {
  const [picked, setPicked] = useState<string>();
  const selected =
    options.find((option) => option.itemInstanceId === picked) ??
    (options.length === 1 ? options[0] : undefined);
  return (
    <div className="space-y-3">
      <div aria-label={groupLabel} className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group">
        {options.map((option) => (
          <div key={option.itemInstanceId} {...{ [cardAttribute]: option.itemInstanceId }}>
            <ItemVisual
              accessibleLabel={`${option.name}, ${option.slotCapacity} slots`}
              badge={`${option.slotCapacity} slots`}
              interactive
              itemId={option.itemId}
              name={option.name}
              onSelect={() => setPicked(option.itemInstanceId)}
              selected={selected?.itemInstanceId === option.itemInstanceId}
            />
          </div>
        ))}
      </div>
      <ActionButton
        {...{ [confirmAttribute]: "" }}
        disabled={busy || selected === undefined}
        intent="primary"
        onClick={() => selected && onConfirm(selected.itemInstanceId)}
      >
        {confirmLabel}
      </ActionButton>
    </div>
  );
}

/**
 * Swap and Remove are rare, so they live in a disclosure at the foot of the
 * panel instead of a permanent row of controls and disabled-state hints. Opened,
 * it shows what is valid now and, for anything that is not, why.
 */
function ContainerManagement({
  base,
  busy,
  container,
  run,
  stash,
}: {
  base: { characterId: string; locationId: string };
  busy: boolean;
  container: SiteStashContainerState;
  run: (
    action: () => Promise<SiteStashActionResult>,
    success: string,
    options?: { hooks?: StorageTransferHooks; revealPanel?: boolean },
  ) => void;
  stash: SiteStashState;
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const reveal = useReveal<HTMLDivElement>(String(open), open);
  const swapChoices = stash.carriedContainers.filter((option) =>
    stash.swappableContainerInstanceIds.includes(option.itemInstanceId),
  );
  return (
    <div
      className={`${SCROLL_MARGIN} mt-4 border-t border-[color:var(--rs-border-subtle)] pt-1`}
      ref={reveal.target}
    >
      <button
        aria-controls={regionId}
        aria-expanded={open}
        className="rs-focus flex min-h-[var(--rs-touch-target)] w-full items-center justify-between gap-3 text-left"
        data-stash-management-toggle
        onClick={() => {
          if (!open) reveal.requestReveal();
          setOpen(!open);
        }}
        type="button"
      >
        <span className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-text-secondary)]">
          Container management
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 font-display text-xs uppercase tracking-wide text-[color:var(--rs-accent-primary)]"
        >
          {open ? "Hide" : "Show"}
        </span>
      </button>
      <div hidden={!open} id={regionId}>
        {open ? (
          <div className="mt-2 space-y-5" data-stash-management>
            <section className="space-y-3">
              <h3 className={SECTION_HEADING}>Swap container</h3>
              {swapChoices.length > 0 ? (
                <ContainerChoice
                  busy={busy}
                  cardAttribute="data-stash-swap-card"
                  confirmAttribute="data-stash-swap-confirm"
                  confirmLabel="Swap to selected container"
                  groupLabel="Containers you can swap in"
                  onConfirm={(itemInstanceId) =>
                    run(
                      () =>
                        swapSiteStashContainerAction({
                          ...base,
                          expectedContainerInstanceId: container.itemInstanceId,
                          itemInstanceId,
                        }),
                      `Swapped in ${swapChoices.find((option) => option.itemInstanceId === itemInstanceId)?.name ?? "the new container"}. Everything stashed stayed put.`,
                    )
                  }
                  options={swapChoices}
                />
              ) : (
                <p className={HINT} data-stash-hint>
                  {stash.carriedContainers.length > 0
                    ? "None of the containers you carry can replace it right now: a swap needs a different kind with room for everything stored here, and room in your Inventory for this one."
                    : "To swap, carry a different kind of container that is not equipped."}
                </p>
              )}
            </section>
            <section className="space-y-3">
              <h3 className={SECTION_HEADING}>Remove container</h3>
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
              <p className={HINT} data-stash-hint>
                {stash.removeBlockedReason === "not_empty"
                  ? "A container can only be removed once the stash is empty."
                  : stash.removeBlockedReason === "carried_capacity"
                    ? "Make room in your Inventory to take the container back."
                    : "It returns to your Inventory, and the mount stays built."}
              </p>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
