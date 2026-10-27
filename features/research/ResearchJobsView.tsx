"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { DialoguePlayer } from "@/features/dialogue/DialoguePlayer";
import { usePlay } from "@/features/play/PlayContext";
import { getDialogue } from "@/game/content/dialogue";
import { getNpc } from "@/game/content/npcs";
import {
  RESEARCH_ACCEPT_LABEL,
  RESEARCH_BLOCKED_DIALOGUE_ID,
  RESEARCH_DECLINE_LABEL,
  RESEARCH_GIVER,
  RESEARCH_PASSAGE_COPY,
  getResearchJob,
  type ResearchJobDefinition,
} from "@/game/content/research-jobs";
import type { CreditsReceipt } from "@/game/domain/conversation";
import {
  assignmentFactsOf,
  researchRunDialogueId,
  researchStage,
  type ResearchOfferProjection,
} from "@/game/domain/research-jobs";
import {
  acceptResearchJobAction,
  completeResearchJobAction,
  teleportResearchJobAction,
} from "@/server/actions";
import { useResearchCommand } from "./use-research-command";

/** What the dialogue on screen can do when its last beat is reached. */
type DialogueAction = "accept" | "collect" | "passage";

type View =
  | { kind: "list" }
  | {
      kind: "dialogue";
      dialogueId: string;
      jobId?: string;
      action?: DialogueAction;
      receipt?: CreditsReceipt;
      /** The server's own words for a refusal, shown beside the scene. */
      notice?: string;
    };

const STATUS_LABEL = {
  available: "Available",
  active: "In progress",
  blocked: "Waiting",
  locked: "",
} as const;

/**
 * The Wise Old Enby's Research Jobs (#406): the separate area under the story
 * interaction that lists the repeatable assignments and plays their dialogue.
 *
 * It is presentation over the server's projection. Which jobs are listed, which
 * is held, whether the character has done a job before (the full introduction
 * versus the short one) and every outcome are the server's. A job locked behind
 * the story is not listed at all. Accepting, collecting payment and opening the
 * passage are commands the server revalidates; nothing here grants an item, pays
 * Credits or moves the character, and no dialogue transaction exists: backing
 * out of any scene changes nothing.
 */
export function ResearchJobsView({
  onBack,
  onClose,
  stationary,
}: {
  onBack: () => void;
  /** Closes the whole conversation, after a confirmed passage has moved the character. */
  onClose: () => void;
  stationary: boolean;
}) {
  const { foregroundBusy, state } = usePlay();
  const command = useResearchCommand();
  const [view, setView] = useState<View>({ kind: "list" });
  const [passageOpen, setPassageOpen] = useState(false);
  const research = state.research;
  const held = research.assignment;
  const heldJob = held ? getResearchJob(held.jobId) : undefined;
  const npc = getNpc(RESEARCH_GIVER.npcId);
  const heldFacts = assignmentFactsOf(held);
  const heldReady = Boolean(heldJob && heldFacts && researchStage(heldJob, heldFacts) === "ready");

  const offers = research.offers.filter((offer) => offer.status !== "locked");

  function backToList() {
    command.setMessage(undefined);
    setView({ kind: "list" });
  }

  function play(
    dialogueId: string,
    extra: Omit<Extract<View, { kind: "dialogue" }>, "kind" | "dialogueId"> = {},
  ) {
    command.setMessage(undefined);
    setView({ kind: "dialogue", dialogueId, ...extra });
  }

  function accept(job: ResearchJobDefinition) {
    if (!stationary) {
      command.setMessage("You must be stationary to take an assignment.");
      return;
    }
    command.run(
      "accept",
      () => acceptResearchJobAction({ characterId: state.characterId, jobId: job.id }),
      (outcome) => {
        if (outcome.status === "ok" && outcome.kind === "already_accepted") {
          // A retry, a second tab or a stale list: the loan was issued earlier, so
          // no item is presented as received now. Show the run that is held.
          backToList();
          command.setMessage(`${job.title} is already your current assignment.`);
        } else if (outcome.status === "ok") {
          play(job.dialogue.accepted, { jobId: job.id });
        } else if (outcome.reason === "capacity") {
          // The authored refusal is presentation for a refused command; the
          // server's message names the actual slot or mass limit.
          play(job.dialogue.capacity, { jobId: job.id, notice: outcome.message });
        }
      },
    );
  }

  function collect(job: ResearchJobDefinition) {
    if (!held) return;
    if (!stationary) {
      command.setMessage("You must be stationary to collect payment.");
      return;
    }
    command.run(
      "collect",
      () =>
        completeResearchJobAction({
          characterId: state.characterId,
          assignmentId: held.assignmentId,
        }),
      (outcome) => {
        if (outcome.status !== "ok") return;
        const completion = job.kind === "calibration" ? undefined : job.dialogue.completion;
        if (completion && outcome.creditsPaid !== undefined) {
          play(completion, {
            jobId: job.id,
            receipt: { amount: outcome.creditsPaid, placement: "leads" },
          });
        } else {
          backToList();
        }
      },
    );
  }

  function teleport() {
    if (!held) return;
    command.run(
      "teleport",
      () =>
        teleportResearchJobAction({
          characterId: state.characterId,
          assignmentId: held.assignmentId,
        }),
      (outcome) => {
        // The character has moved; the NPC is no longer here, so the whole
        // conversation closes and the arrival modal presents over the Crash Site.
        if (outcome.status === "ok") {
          setPassageOpen(false);
          onClose();
        } else {
          setPassageOpen(false);
        }
      },
    );
  }

  if (view.kind === "dialogue") {
    const sequence = getDialogue(view.dialogueId);
    const job = view.jobId ? getResearchJob(view.jobId) : undefined;
    if (sequence) {
      const action = view.action;
      const actionLabel =
        action === "accept"
          ? RESEARCH_ACCEPT_LABEL
          : action === "collect"
            ? job?.finalActionLabel
            : action === "passage"
              ? RESEARCH_PASSAGE_COPY.open
              : undefined;
      return (
        <div data-research-dialogue={view.dialogueId}>
          <DialoguePlayer
            actionBusy={command.pending !== undefined}
            {...(actionLabel ? { actionLabel } : {})}
            actionMessage={command.message ?? view.notice}
            {...(action === "accept" ? { declineLabel: RESEARCH_DECLINE_LABEL } : {})}
            onAction={() => {
              if (!job) return;
              if (action === "accept") accept(job);
              else if (action === "collect") collect(job);
              else if (action === "passage") setPassageOpen(true);
            }}
            onBack={backToList}
            onFinish={backToList}
            {...(view.receipt ? { receipt: view.receipt } : {})}
            sequence={sequence}
          />
          {passageOpen && held ? (
            <PassageConfirmation
              busy={command.pending === "teleport"}
              fareCredits={state.passenger.fareCredits}
              message={command.message}
              onConfirm={teleport}
              onDecline={() => setPassageOpen(false)}
            />
          ) : null}
        </div>
      );
    }
  }

  return (
    <div className="mt-4" data-research-jobs>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-[11px] uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]">
          Research Jobs
        </h3>
        <ActionButton data-research-back intent="secondary" onClick={onBack}>
          Back
        </ActionButton>
      </div>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        {npc?.displayName ?? "The Wise Old Enby"} keeps one research assignment going at a time.
        Story missions are not affected.
      </p>
      <ul className="mt-3 space-y-3">
        {offers.map((offer) => {
          const job = getResearchJob(offer.jobId);
          if (!job) return null;
          return (
            <JobCard
              blockedBy={offer.status === "blocked" ? heldJob?.title : undefined}
              disabled={foregroundBusy || command.pending !== undefined}
              job={job}
              key={job.id}
              offer={offer}
              onAskBlocked={() => play(RESEARCH_BLOCKED_DIALOGUE_ID, { jobId: job.id })}
              onOffer={() =>
                play(offer.completions > 0 ? job.dialogue.repeatOffer : job.dialogue.firstOffer, {
                  jobId: job.id,
                  action: "accept",
                })
              }
              onReplay={() => play(job.dialogue.firstOffer, { jobId: job.id })}
              onRun={() => {
                const facts = assignmentFactsOf(held);
                if (!facts) return;
                const ready = researchStage(job, facts) === "ready";
                play(researchRunDialogueId(job, facts), {
                  jobId: job.id,
                  ...(ready ? { action: job.kind === "calibration" ? "passage" : "collect" } : {}),
                });
              }}
              ready={heldReady}
            />
          );
        })}
      </ul>
      {command.message ? <Feedback tone="danger">{command.message}</Feedback> : null}
    </div>
  );
}

function JobCard({
  job,
  offer,
  blockedBy,
  disabled,
  ready,
  onOffer,
  onReplay,
  onRun,
  onAskBlocked,
}: {
  job: ResearchJobDefinition;
  offer: ResearchOfferProjection;
  blockedBy: string | undefined;
  disabled: boolean;
  ready: boolean;
  onOffer: () => void;
  onReplay: () => void;
  onRun: () => void;
  onAskBlocked: () => void;
}) {
  const active = offer.status === "active";
  return (
    <li
      className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
      data-research-job={job.id}
      data-research-job-status={offer.status}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-display text-sm font-bold uppercase tracking-wide">{job.title}</p>
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--rs-text-secondary)]">
          {STATUS_LABEL[offer.status]}
        </span>
      </div>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]" data-research-job-pitch>
        {job.pitch}
      </p>
      <dl className="mt-2 space-y-1 text-xs text-[color:var(--rs-text-secondary)]">
        <div>
          <dt className="inline font-semibold text-[color:var(--rs-text-primary)]">Needs: </dt>
          <dd className="inline">{job.requirements}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-[color:var(--rs-text-primary)]">Reward: </dt>
          <dd className="inline" data-research-job-reward>
            {job.rewardLabel}
          </dd>
        </div>
      </dl>
      {offer.status === "blocked" ? (
        <p className="mt-2 text-sm" data-research-job-blocked>
          You are already working on {blockedBy ?? "another assignment"}. Finish or abandon it
          first.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {offer.status === "available" ? (
          <>
            <ActionButton
              data-research-job-open
              disabled={disabled}
              intent="primary"
              onClick={onOffer}
            >
              {offer.completions > 0 ? "Take this job again" : "Hear the offer"}
            </ActionButton>
            {offer.completions > 0 ? (
              <ActionButton
                data-research-job-replay
                disabled={disabled}
                intent="secondary"
                onClick={onReplay}
              >
                Hear the full briefing
              </ActionButton>
            ) : null}
          </>
        ) : null}
        {active ? (
          <MissionActionButton
            data-research-job-run
            disabled={disabled}
            guidance={ready ? "turn_in" : undefined}
            intent="primary"
            onClick={onRun}
          >
            {ready
              ? job.kind === "calibration"
                ? "Report back"
                : "Report back to collect"
              : "Talk about this assignment"}
          </MissionActionButton>
        ) : null}
        {offer.status === "blocked" ? (
          <ActionButton
            data-research-job-blocked-ask
            disabled={disabled}
            intent="secondary"
            onClick={onAskBlocked}
          >
            Ask about it
          </ActionButton>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The final confirmation before the Calibration passage (#406): a separate
 * RuneSpace modal, not NPC dialogue. NOT YET, Escape, the Close control and a tap
 * outside are one non-committing path; only TELEPORT NOW sends the command.
 */
function PassageConfirmation({
  busy,
  fareCredits,
  message,
  onConfirm,
  onDecline,
}: {
  busy: boolean;
  fareCredits: number;
  message: string | undefined;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  return (
    <Drawer
      eyebrow="Resonance Calibration"
      label="Confirm passage to Skatboll"
      onClose={onDecline}
      title="Passage"
    >
      <div data-research-passage-confirmation>
        {/* The drawer header ellipsizes long titles; the question sits in the body. */}
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-[color:var(--rs-text-primary)]">
          {RESEARCH_PASSAGE_COPY.heading}
        </h2>
        <p className="mt-2 text-sm text-[color:var(--rs-text-primary)]">
          The Wise Old Enby will teleport your character to Crash Site, Skatboll.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[color:var(--rs-text-secondary)]">
          <li>Your carried Inventory and Equipment come with you.</li>
          <li>Your Rivet, its fuel and your Cargo Hold stay exactly where they are parked.</li>
          <li>
            If your Rivet is at Stillreach, getting it back may need separate passage. Milky Waymo
            costs {fareCredits} Credits one-way once you have unlocked it.
          </li>
          <li>The loaned Resonance Sampler is reclaimed only if you confirm.</li>
          <li>No Credits or XP are paid or charged.</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton
            data-research-passage-decline
            disabled={busy}
            intent="secondary"
            onClick={onDecline}
          >
            {RESEARCH_PASSAGE_COPY.decline}
          </ActionButton>
          <ActionButton
            data-research-passage-confirm
            intent="primary"
            loading={busy}
            onClick={onConfirm}
          >
            {RESEARCH_PASSAGE_COPY.teleport}
          </ActionButton>
        </div>
        {message ? <Feedback tone="danger">{message}</Feedback> : null}
      </div>
    </Drawer>
  );
}
