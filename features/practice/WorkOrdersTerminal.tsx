"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LOCATION_IDS } from "@/game/config/foundations";
import { usePlay } from "@/features/play/PlayContext";
import { WORKBENCH_ANCHOR_ID } from "@/features/practice/WorkbenchPanel";
import {
  acceptWorkOrderAction,
  refreshWorkOrderBoardAction,
  type WorkOrderActionResult,
  type WorkOrderRefreshActionResult,
} from "@/server/actions";
import type { WorkOrderPostingProjection, WorkOrderRefreshProjection } from "@/server/play";

/**
 * The Work Orders terminal at Rusk Recovery (#190, made playable by #207).
 *
 * The beat-up industrial terminal is physically in the scene from the very
 * first visit, and until 10,000 Hours is turned in it is exactly that: scenery.
 * No label, no click target, no disabled state, no teaser — nothing here
 * renders at all.
 *
 * After that it tells the truth about where the player actually is, which is
 * three different messages rather than one empty state. Below Welding 5 it
 * names the level real client work needs. At Welding 5, before Wade has handed
 * the board over, it points at Wade — saying "no Work Orders available" there
 * would be a lie, because there are three of them and they are simply not the
 * player's yet. Once 10,001 Hours is accepted it is the real board, and it
 * stays the real board even while that Mission waits to be turned in.
 *
 * It is a small practical shop queue, not an MMO quest board: three postings,
 * each one job, a client, what it takes, how much of it there is, and what it
 * pays.
 */
export function WorkOrdersTerminal() {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState<{
    tone: "danger" | "success";
    text: string;
  }>();
  const [, startTransition] = useTransition();
  // Set only after a successful acceptance commits, so focus moves once the
  // Workbench is genuinely rendering the accepted job — never before the
  // success state exists.
  const [handoffPending, setHandoffPending] = useState(false);
  const activeWorkOrderId = state.workOrders.active?.workOrderId;
  const handedOffFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!handoffPending || !activeWorkOrderId) return;
    if (handedOffFor.current === activeWorkOrderId) return;
    handedOffFor.current = activeWorkOrderId;
    setHandoffPending(false);
    moveToWorkbench();
  }, [handoffPending, activeWorkOrderId]);

  // The terminal is a physical thing in Wade's yard, so it shows where it
  // stands and nowhere else.
  if (state.location.currentLocationId !== LOCATION_IDS.ruskRecovery || state.travelState) {
    return null;
  }
  // Both the reveal and the level requirement are authoritative projection: this
  // surface never learns a Mission ID or a balance literal of its own.
  const { revealed, requiredWeldingLevel, unlocked, missionAvailable, postings, refresh } =
    state.workOrders;
  if (!revealed) return null;

  function applyResult(result: WorkOrderActionResult) {
    if ("error" in result) {
      setMessage(result.error);
      return;
    }
    acceptState(result.state);
    if (result.workOrder.status === "refused") {
      setMessage(result.workOrder.message);
      return;
    }
    setMessage(undefined);
    if (result.workOrder.status === "accepted") setHandoffPending(true);
  }

  function accept(workOrderId: string) {
    enqueueForeground(() => {
      setPending(workOrderId);
      startTransition(async () => {
        try {
          applyResult(await acceptWorkOrderAction({ characterId: state.characterId, workOrderId }));
        } catch {
          setMessage("Comms interruption. The job could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(undefined);
        }
      });
    });
  }

  function applyRefreshResult(result: WorkOrderRefreshActionResult) {
    if ("error" in result) {
      setRefreshFeedback({ tone: "danger", text: result.error });
      return;
    }
    acceptState(result.state);
    if (result.refresh.status === "refused") {
      setRefreshFeedback({ tone: "danger", text: result.refresh.message });
      return;
    }
    setRefreshFeedback({ tone: "success", text: "Queue refreshed. New postings loaded." });
  }

  function refreshBoard() {
    enqueueForeground(() => {
      setRefreshPending(true);
      setRefreshFeedback(undefined);
      startTransition(async () => {
        try {
          applyRefreshResult(await refreshWorkOrderBoardAction({ characterId: state.characterId }));
        } catch {
          setRefreshFeedback({
            tone: "danger",
            text: "Comms interruption. The refresh could not be confirmed.",
          });
        } finally {
          releaseCommand();
          setRefreshPending(false);
        }
      });
    });
  }

  // `missionAvailable` is the projection's own answer to "is the board simply
  // not theirs yet", so the terminal never re-derives it from a level literal.
  const terminalState = !unlocked
    ? missionAvailable
      ? "awaiting_wade"
      : "locked"
    : postings.length === 0
      ? "empty"
      : "open";

  return (
    <Panel tone="raised" data-work-orders-terminal data-work-orders-state={terminalState}>
      <SectionHeader eyebrow="Rusk Recovery" level={2}>
        Work Orders
      </SectionHeader>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        The terminal in the corner is where paying jobs come in off the wire.
      </p>
      {/* ForceSales is restrained secondary flavor on an otherwise ordinary shop
          queue (#217) — the terminal's own generic SaaS vendor, never a
          renamed panel identity. */}
      <p
        className="mt-1 text-xs uppercase tracking-[0.12em] text-[color:var(--rs-text-muted)]"
        data-work-orders-branding
      >
        Powered by ForceSales Free
      </p>

      {refresh.unlocked ? (
        <ForceSalesRefreshPanel
          busy={foregroundBusy}
          onRefresh={refreshBoard}
          pending={refreshPending}
          refresh={refresh}
        />
      ) : null}
      {refreshFeedback ? (
        <Feedback tone={refreshFeedback.tone}>{refreshFeedback.text}</Feedback>
      ) : null}

      {terminalState === "locked" ? (
        <div className="mt-4">
          <ActionButton data-work-orders-control disabled intent="secondary">
            {`Requires Welding Level ${requiredWeldingLevel}`}
          </ActionButton>
        </div>
      ) : null}

      {terminalState === "awaiting_wade" ? (
        <p
          className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]"
          data-work-orders-await-wade
        >
          There is work on the board, but it is not yours to take yet. Talk to Wade Rusk about Work
          Orders.
        </p>
      ) : null}

      {terminalState === "empty" ? (
        <div className="mt-4">
          <ActionButton data-work-orders-control disabled intent="secondary">
            No Work Orders Available
          </ActionButton>
        </div>
      ) : null}

      {terminalState === "open" ? (
        <>
          {/* One column on a phone, widening only where there is genuinely room
              for three jobs to be read side by side. */}
          <ul className="mt-4 grid gap-3 lg:grid-cols-3" data-work-orders-board>
            {postings.map((posting) => (
              <WorkOrderPosting
                key={posting.slotIndex}
                busy={foregroundBusy}
                onAccept={accept}
                pending={pending === posting.workOrderId}
                posting={posting}
              />
            ))}
          </ul>
          {activeWorkOrderId ? (
            <div className="mt-4">
              <ActionButton
                data-work-orders-goto-workbench
                intent="secondary"
                onClick={moveToWorkbench}
              >
                Go to Workbench
              </ActionButton>
            </div>
          ) : null}
        </>
      ) : null}

      {message ? (
        <div className="mt-4">
          <Feedback tone="danger">{message}</Feedback>
        </div>
      ) : null}
    </Panel>
  );
}

/**
 * Move the player to the bench.
 *
 * Scroll and focus rather than a route, because the Workbench is already a
 * sibling panel on this surface and a route system for one hop between two
 * panels would be a worse answer. `preventScroll` lets the smooth scroll do the
 * moving while focus lands without a second competing jump.
 */
function moveToWorkbench() {
  const bench = document.getElementById(WORKBENCH_ANCHOR_ID);
  if (!bench) return;
  bench.scrollIntoView({ behavior: "smooth", block: "start" });
  bench.focus({ preventScroll: true });
}

function WorkOrderPosting({
  busy,
  onAccept,
  pending,
  posting,
}: {
  busy: boolean;
  onAccept: (workOrderId: string) => void;
  pending: boolean;
  posting: WorkOrderPostingProjection;
}) {
  return (
    <li
      className="flex flex-col gap-3 border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-3"
      data-work-order-posting={posting.workOrderId}
      data-work-order-in-progress={String(posting.inProgress)}
    >
      {/* The job and who wants it, then the payout. A shop queue is read
          "what is it, and what does it pay" — those are the two facts that
          decide whether the rest is worth reading at all. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-[color:var(--rs-text-primary)]">
            {posting.title}
          </p>
          <p className="text-xs uppercase tracking-[0.12em] text-[color:var(--rs-text-muted)]">
            {posting.clientName}
          </p>
        </div>
        <p
          className="shrink-0 whitespace-nowrap border border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)] px-2 py-1 font-display text-sm font-bold text-[color:var(--rs-accent-primary)]"
          data-work-order-payout
        >
          {`${posting.payoutCredits} Cr`}
        </p>
      </div>

      <p className="text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        {posting.description}
      </p>

      {/* Each material carries its own state, because a mixed job is two
          separate questions: a player with the ferrite but not the cells needs
          to see which one is the problem without recounting their Inventory.
          Colour is never the rule — every row states carried / required, and
          the shortage sentence below says it again in words. */}
      <ul className="flex flex-col gap-1" data-work-order-materials>
        {posting.materials.map((material) => {
          const enough = material.carried >= material.quantity;
          return (
            <li
              key={material.itemId}
              className={`flex items-baseline justify-between gap-3 border-l-2 pl-2 text-xs ${
                enough
                  ? "border-[color:var(--rs-accent-success)] text-[color:var(--rs-accent-success)]"
                  : "border-[color:var(--rs-accent-danger)] text-[color:var(--rs-accent-danger)]"
              }`}
              data-work-order-material={material.itemId}
              data-work-order-material-met={String(enough)}
            >
              <span className="truncate">{material.itemName}</span>
              <span className="shrink-0 font-semibold tabular-nums">
                {`${Math.min(material.carried, material.quantity)} / ${material.quantity}`}
              </span>
            </li>
          );
        })}
      </ul>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-[color:var(--rs-border-subtle)] pt-2 text-xs text-[color:var(--rs-text-secondary)]">
        <dt className="text-[color:var(--rs-text-muted)]">Work</dt>
        <dd className="tabular-nums">{`${posting.sections} sections`}</dd>
        <dt className="text-[color:var(--rs-text-muted)]">Welding</dt>
        <dd className="tabular-nums">{`Level ${posting.requiredWeldingLevel}`}</dd>
        {posting.requiredRefiningLevel !== undefined ? (
          <>
            <dt className="text-[color:var(--rs-text-muted)]">Refining</dt>
            <dd className="tabular-nums">{`Level ${posting.requiredRefiningLevel}`}</dd>
          </>
        ) : null}
      </dl>

      {posting.inProgress ? (
        <p
          className="border border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)] px-2 py-1 text-center font-display text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]"
          data-work-order-status
        >
          In Progress
        </p>
      ) : (
        <>
          <ActionButton
            data-work-order-accept={posting.workOrderId}
            disabled={!posting.acceptable || busy}
            intent="secondary"
            loading={pending}
            onClick={() => onAccept(posting.workOrderId)}
          >
            Accept Job
          </ActionButton>
          {/* A disabled control on its own tells the player nothing they can
              act on, so the reason is always in words beside it — and in the
              danger treatment, because it is the actionable state of this card
              rather than background helper text. */}
          {posting.blockedReason ? (
            <p
              className="text-xs font-semibold leading-relaxed text-[color:var(--rs-accent-danger)]"
              data-work-order-blocked={posting.blockedReason}
              role="status"
            >
              {blockedCopy(posting)}
            </p>
          ) : null}
        </>
      )}
    </li>
  );
}

/**
 * ForceSales' one-per-Pacific-day full-board refresh (#217).
 *
 * Three settled copy states, chosen from the authoritative projection alone —
 * never a client-side guess at "just unlocked" or "used it recently". The
 * first-unlock treatment is never color-only: its own labeled copy carries the
 * meaning, matching the existing "In Progress" badge's pattern of an
 * uppercase-styled label over ordinary-case text.
 */
function ForceSalesRefreshPanel({
  busy,
  onRefresh,
  pending,
  refresh,
}: {
  busy: boolean;
  onRefresh: () => void;
  pending: boolean;
  refresh: WorkOrderRefreshProjection;
}) {
  const panelState = !refresh.availableToday
    ? "used_today"
    : refresh.firstUnlock
      ? "first_unlock"
      : "available";

  return (
    <div
      className={`mt-4 border p-3 ${
        panelState === "first_unlock"
          ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)]"
          : "border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)]"
      }`}
      data-work-orders-refresh
      data-work-orders-refresh-state={panelState}
    >
      {panelState === "first_unlock" ? (
        <>
          <p className="font-display text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
            New Work Available
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
            Your contractor profile now qualifies for conductive repair work.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
            ForceSales Free has unlocked 1 complimentary queue refresh per day. Refresh now to pull
            from your expanded job pool.
          </p>
          <div className="mt-3">
            <ActionButton
              data-work-orders-refresh-control
              disabled={busy}
              intent="primary"
              loading={pending}
              onClick={onRefresh}
            >
              Refresh Board — Free
            </ActionButton>
          </div>
        </>
      ) : null}

      {panelState === "available" ? (
        <>
          <p className="font-display text-sm font-semibold text-[color:var(--rs-text-primary)]">
            ForceSales Free · 1 refresh available today
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
            Replaces all unaccepted postings. In Progress work stays put.
          </p>
          <div className="mt-3">
            <ActionButton
              data-work-orders-refresh-control
              disabled={busy}
              intent="secondary"
              loading={pending}
              onClick={onRefresh}
            >
              Refresh Board
            </ActionButton>
          </div>
        </>
      ) : null}

      {panelState === "used_today" ? (
        <>
          <p className="font-display text-sm font-semibold text-[color:var(--rs-text-primary)]">
            ForceSales Free · Daily refresh used
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
            Additional refreshes require ForceSales Pro.
          </p>
          {/* Settled copy, not a real upgrade path (#217): no Pro purchase flow
              exists, so this line is flavor text, never a control. */}
          <p className="mt-1 text-sm font-semibold leading-relaxed text-[color:var(--rs-text-secondary)]">
            Contact your Network Administrator to authorize an upgrade.
          </p>
        </>
      ) : null}
    </div>
  );
}

function blockedCopy(posting: WorkOrderPostingProjection): string {
  switch (posting.blockedReason) {
    case "welding_level":
      return `Needs Welding level ${posting.requiredWeldingLevel}.`;
    case "refining_level":
      return `Needs Refining level ${posting.requiredRefiningLevel}.`;
    case "materials": {
      const short = posting.materials.filter((material) => material.carried < material.quantity);
      return `You are short ${short
        .map((material) => {
          const missing = material.quantity - material.carried;
          // Item names are authored singular, so a shortage of more than one
          // reads "3 Power Cells" rather than "3 Power Cell".
          return `${missing} ${material.itemName}${missing === 1 ? "" : "s"}`;
        })
        .join(" and ")}.`;
    }
    case "work_order_active":
      return "Finish the job already on the bench first.";
    case "workbench_occupied":
      return "The Workbench still has an unfinished practice weld on it.";
    case "not_here":
      return "Jobs are accepted at the terminal, standing still.";
    default:
      return "";
  }
}
