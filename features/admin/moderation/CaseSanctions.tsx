"use client";

import { useState } from "react";
import { Feedback } from "@/components/ui/Feedback";
import {
  APPEAL_OUTCOMES,
  MODERATION_RULE_CATEGORIES,
  MODERATION_RULE_LABEL,
  SANCTION_DURATION_KEYS,
  SANCTION_DURATION_LABEL,
  SANCTION_KIND_LABEL,
  SANCTION_KINDS,
  APPEAL_OUTCOME_LABEL,
  type AppealOutcome,
  type ModerationRuleCategory,
  type SanctionDuration,
  type SanctionKind,
} from "@/game/domain/moderation";
import type { CaseSanctionView } from "@/game/schemas/moderation";
import {
  changeSanctionDurationAction,
  decideAppealAction,
  issueSanctionAction,
  reverseSanctionAction,
} from "@/server/moderation-actions";
import { ConfirmAction } from "../ConfirmAction";
import { controlClass, Id, ModerationTime } from "./ModerationParts";
import { useModerationMutation } from "./useModerationMutation";

const STATE_LABEL: Record<CaseSanctionView["state"], string> = {
  in_effect: "In effect",
  expired: "Expired",
  reversed: "Reversed",
  recorded: "Recorded (warning)",
};

/** `for 7 days` / `permanently`, for a concrete confirmation sentence. */
function forDuration(duration: SanctionDuration): string {
  return duration === "permanent" ? "permanently" : `for ${SANCTION_DURATION_LABEL[duration]}`;
}

/** The concrete consequence an operator confirms before a sanction is issued. */
function issuePrompt(
  kind: SanctionKind,
  rule: ModerationRuleCategory,
  duration: SanctionDuration,
): string {
  const cited = `It cites "${MODERATION_RULE_LABEL[rule]}", marks the case Actioned, and appears in the player's notices.`;
  if (kind === "warning") {
    return `Record a warning on this account? It restricts nothing. ${cited}`;
  }
  if (kind === "social_restriction") {
    return `Restrict all characters on this account from chat, Whispers, promoted ads, and starting trades ${forDuration(duration)}? ${cited}`;
  }
  return `Suspend this account so no character on it can enter RuneSpace gameplay ${forDuration(duration)}? ${cited}`;
}

function Select<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <label className="block min-w-0 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
      {label}
      <select
        className={`${controlClass} normal-case`}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const DURATION_OPTIONS = SANCTION_DURATION_KEYS.map((key) => ({
  value: key,
  label: SANCTION_DURATION_LABEL[key],
}));

/**
 * The case's sanctions: an issue form, then each sanction with its
 * duration/reversal controls and any appeal. The server owns every rule
 * (who may be sanctioned, what a warning can carry, what an appeal may do);
 * this only presents the choices and confirms the concrete consequence.
 */
export function CaseSanctions({
  caseId,
  sanctions,
}: {
  caseId: string;
  sanctions: CaseSanctionView[];
}) {
  return (
    <>
      <IssueSanctionForm caseId={caseId} />
      {sanctions.length === 0 ? (
        <p className="text-[color:var(--rs-text-muted)]">No sanctions on this case.</p>
      ) : (
        <ol aria-label="Case sanctions" className="space-y-3">
          {sanctions.map((sanction) => (
            <SanctionItem key={sanction.sanctionId} sanction={sanction} />
          ))}
        </ol>
      )}
    </>
  );
}

function IssueSanctionForm({ caseId }: { caseId: string }) {
  const [kind, setKind] = useState<SanctionKind>("warning");
  const [rule, setRule] = useState<ModerationRuleCategory>(MODERATION_RULE_CATEGORIES[0]);
  const [duration, setDuration] = useState<SanctionDuration>("7d");
  const { feedback, run } = useModerationMutation();

  return (
    <div className="space-y-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--rs-text-secondary)]">
        Issue a sanction
      </h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <Select
          label="Sanction"
          value={kind}
          onChange={setKind}
          options={SANCTION_KINDS.map((key) => ({ value: key, label: SANCTION_KIND_LABEL[key] }))}
        />
        <Select
          label="Rule"
          value={rule}
          onChange={setRule}
          options={MODERATION_RULE_CATEGORIES.map((key) => ({
            value: key,
            label: MODERATION_RULE_LABEL[key],
          }))}
        />
        {kind === "warning" ? null : (
          <Select
            label="Duration"
            value={duration}
            onChange={setDuration}
            options={DURATION_OPTIONS}
          />
        )}
      </div>
      <ConfirmAction
        label="Issue sanction"
        confirmLabel="Issue sanction"
        intent={kind === "warning" ? "secondary" : "danger"}
        title={`Issue ${SANCTION_KIND_LABEL[kind].toLowerCase()}?`}
        prompt={issuePrompt(kind, rule, duration)}
        onConfirm={async () => {
          await run(
            () =>
              issueSanctionAction({
                caseId,
                kind,
                ruleCategory: rule,
                duration: kind === "warning" ? null : duration,
              }),
            `${SANCTION_KIND_LABEL[kind]} issued.`,
          );
        }}
      />
      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}
    </div>
  );
}

function SanctionItem({ sanction }: { sanction: CaseSanctionView }) {
  const { feedback, run } = useModerationMutation();
  const [newDuration, setNewDuration] = useState<SanctionDuration>(sanction.duration ?? "7d");
  const kindLabel = SANCTION_KIND_LABEL[sanction.kind];
  const reversed = sanction.state === "reversed";

  return (
    <li className="min-w-0 space-y-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-semibold text-[color:var(--rs-text-primary)]">{kindLabel}</h3>
        <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--rs-text-secondary)]">
          {STATE_LABEL[sanction.state]}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <SanctionField label="Rule">{MODERATION_RULE_LABEL[sanction.ruleCategory]}</SanctionField>
        <SanctionField label="Duration">
          {sanction.duration ? SANCTION_DURATION_LABEL[sanction.duration] : "None (warning)"}
        </SanctionField>
        <SanctionField label="Starts">
          <ModerationTime value={sanction.startsAt} />
        </SanctionField>
        <SanctionField label="Ends">
          {sanction.endsAt ? (
            <ModerationTime value={sanction.endsAt} />
          ) : sanction.kind === "warning" ? (
            "Never restricts"
          ) : (
            "Permanent"
          )}
        </SanctionField>
        <SanctionField label="Issued by">
          <Id value={sanction.issuedByAdminUserId} />
        </SanctionField>
        {sanction.reversedAt ? (
          <SanctionField label="Reversed">
            <ModerationTime value={sanction.reversedAt} />
            {sanction.reversedByAdminUserId ? (
              <>
                {" by "}
                <Id value={sanction.reversedByAdminUserId} />
              </>
            ) : null}
          </SanctionField>
        ) : null}
      </dl>

      {reversed ? null : (
        <div className="flex flex-wrap items-end gap-2">
          {sanction.kind === "warning" ? null : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-40">
                <Select
                  label="New duration"
                  value={newDuration}
                  onChange={setNewDuration}
                  options={DURATION_OPTIONS}
                />
              </div>
              <ConfirmAction
                label="Change duration"
                confirmLabel="Change duration"
                intent="secondary"
                disabled={newDuration === sanction.duration}
                prompt={`Change this ${kindLabel.toLowerCase()} from ${
                  sanction.duration
                    ? SANCTION_DURATION_LABEL[sanction.duration]
                    : "its current duration"
                } to ${SANCTION_DURATION_LABEL[newDuration]}? The end time is recalculated from when it started.`}
                onConfirm={async () => {
                  await run(
                    () =>
                      changeSanctionDurationAction({
                        sanctionId: sanction.sanctionId,
                        duration: newDuration,
                      }),
                    "Duration changed.",
                  );
                }}
              />
            </div>
          )}
          <ConfirmAction
            label="Reverse"
            confirmLabel="Reverse"
            prompt={
              sanction.kind === "warning"
                ? "Reverse this warning? It is marked reversed and no longer counts as current."
                : `Reverse this ${kindLabel.toLowerCase()}? It stops applying to every character on this account immediately.`
            }
            onConfirm={async () => {
              await run(
                () => reverseSanctionAction({ sanctionId: sanction.sanctionId }),
                `${kindLabel} reversed.`,
              );
            }}
          />
        </div>
      )}
      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}

      {sanction.appeal ? <AppealBlock sanction={sanction} appeal={sanction.appeal} /> : null}
    </li>
  );
}

function SanctionField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="uppercase tracking-wide text-[color:var(--rs-text-muted)]">{label}</dt>
      <dd className="break-words text-[color:var(--rs-text-primary)]">{children}</dd>
    </div>
  );
}

const OUTCOME_CHOICE_LABEL: Record<AppealOutcome, string> = {
  upheld: "Uphold",
  modified: "Modify",
  reversed: "Reverse",
};

/** The player's appeal on one sanction: their words, and the decision or the form to make it. */
function AppealBlock({
  sanction,
  appeal,
}: {
  sanction: CaseSanctionView;
  appeal: NonNullable<CaseSanctionView["appeal"]>;
}) {
  const decided = appeal.outcome !== null;
  return (
    <div className="space-y-2 border-t border-[color:var(--rs-border-structural)] pt-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--rs-accent-arcane)]">
        Player appeal
      </h4>
      <p className="whitespace-pre-wrap break-words border-l-2 border-[color:var(--rs-accent-arcane)] pl-3 text-[color:var(--rs-text-primary)]">
        {appeal.body}
      </p>
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        Submitted <ModerationTime value={appeal.submittedAt} />
      </p>
      {decided && appeal.outcome ? (
        <div className="text-xs text-[color:var(--rs-text-primary)]">
          <p>
            <span className="font-semibold">Decision: {APPEAL_OUTCOME_LABEL[appeal.outcome]}</span>
            {appeal.decidedAt ? (
              <>
                {" · "}
                <ModerationTime value={appeal.decidedAt} />
              </>
            ) : null}
            {appeal.decidedByAdminUserId ? (
              <>
                {" · by "}
                <Id value={appeal.decidedByAdminUserId} />
              </>
            ) : null}
          </p>
          {appeal.decisionNote ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-[color:var(--rs-text-secondary)]">
              Internal note: {appeal.decisionNote}
            </p>
          ) : null}
        </div>
      ) : (
        <DecideAppealForm sanction={sanction} appealId={appeal.appealId} />
      )}
    </div>
  );
}

function DecideAppealForm({
  sanction,
  appealId,
}: {
  sanction: CaseSanctionView;
  appealId: string;
}) {
  const [outcome, setOutcome] = useState<AppealOutcome>("upheld");
  const [duration, setDuration] = useState<SanctionDuration>("7d");
  const [note, setNote] = useState("");
  const { feedback, run } = useModerationMutation();
  const kindLabel = SANCTION_KIND_LABEL[sanction.kind].toLowerCase();
  // A warning has no duration to modify.
  const outcomes = APPEAL_OUTCOMES.filter(
    (key) => key !== "modified" || sanction.kind !== "warning",
  );

  const prompt =
    outcome === "upheld"
      ? `Uphold this ${kindLabel}? It stays exactly as issued and the player sees the appeal was upheld.`
      : outcome === "modified"
        ? `Modify this ${kindLabel} to ${SANCTION_DURATION_LABEL[duration]}? The end time is recalculated from when it started, and the player sees the appeal was modified.`
        : `Reverse this ${kindLabel}? It stops applying immediately and the player sees the appeal was decided in their favour.`;

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          label="Appeal outcome"
          value={outcome}
          onChange={setOutcome}
          options={outcomes.map((key) => ({ value: key, label: OUTCOME_CHOICE_LABEL[key] }))}
        />
        {outcome === "modified" ? (
          <Select
            label="New duration"
            value={duration}
            onChange={setDuration}
            options={DURATION_OPTIONS}
          />
        ) : null}
      </div>
      <label className="block text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
        Internal note (optional)
        <textarea
          className={`${controlClass} min-h-16 normal-case`}
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <ConfirmAction
        label="Decide appeal"
        confirmLabel="Decide appeal"
        intent="secondary"
        prompt={prompt}
        onConfirm={async () => {
          await run(
            () =>
              decideAppealAction({
                appealId,
                outcome,
                duration: outcome === "modified" ? duration : null,
                ...(note.trim() ? { note } : {}),
              }),
            `Appeal decided: ${APPEAL_OUTCOME_LABEL[outcome]}.`,
          );
        }}
      />
      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}
    </div>
  );
}
