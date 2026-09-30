"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import {
  loadAccountModerationHistoryAction,
  openModerationCaseAction,
} from "@/server/moderation-actions";
import type { AccountModerationHistory } from "@/server/moderation-seams";
import { controlClass, ModerationTime, StatusBadge } from "./moderation/ModerationParts";

/**
 * Moderation panel on the selected-character inspector (issue #248). The
 * character resolves its owning account; cases are about that WHOLE account.
 * Reading the history is a privileged view that is recorded, so it loads only
 * on request. Opening a case needs a stated reason; if the account already
 * has an open or reviewed case the server returns that one unchanged.
 */
export function AdminModerationPanel({ characterId }: { characterId: string }) {
  const router = useRouter();
  const [history, setHistory] = useState<AccountModerationHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [opening, setOpening] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    tone: "success" | "danger" | "muted";
  } | null>(null);

  async function showHistory() {
    setLoading(true);
    setFeedback(null);
    try {
      const result = await loadAccountModerationHistoryAction({ characterId });
      if ("error" in result) setFeedback({ text: result.error, tone: "danger" });
      else setHistory(result);
    } catch {
      setFeedback({ text: "The request failed. Try again.", tone: "danger" });
    } finally {
      setLoading(false);
    }
  }

  async function openCase(event: React.FormEvent) {
    event.preventDefault();
    setOpening(true);
    setFeedback(null);
    try {
      const result = await openModerationCaseAction({ characterId, reason });
      if ("error" in result) {
        setFeedback({ text: result.error, tone: "danger" });
        return;
      }
      if (!result.changed) {
        setFeedback({
          text: "This account already has an active case. Opening it instead.",
          tone: "muted",
        });
      }
      router.push(`/admin/moderation/${result.caseId}`);
    } catch {
      setFeedback({ text: "The request failed. Try again.", tone: "danger" });
    } finally {
      setOpening(false);
    }
  }

  return (
    <Panel className="p-4" tone="raised" aria-labelledby="account-moderation-heading">
      <h2
        className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]"
        id="account-moderation-heading"
      >
        Moderation
      </h2>
      <div className="mt-3 space-y-4 text-sm">
        <div>
          <ActionButton intent="secondary" loading={loading} onClick={showHistory}>
            Show moderation history
          </ActionButton>
          <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
            Loading this account&apos;s cases is recorded in the privileged access log.
          </p>
          {history ? (
            history.cases.length === 0 ? (
              <p className="mt-2 text-[color:var(--rs-text-muted)]">
                No moderation cases on this account.
              </p>
            ) : (
              <ul aria-label="Account moderation cases" className="mt-2 space-y-2">
                {history.cases.map((moderationCase) => (
                  <li
                    key={moderationCase.caseId}
                    className="flex flex-wrap items-center gap-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] px-3 py-2"
                  >
                    <Link
                      className="rs-focus font-semibold text-[color:var(--rs-accent-primary)] underline"
                      href={`/admin/moderation/${moderationCase.caseId}`}
                    >
                      {moderationCase.reference}
                    </Link>
                    <StatusBadge status={moderationCase.status} />
                    <span className="text-xs text-[color:var(--rs-text-muted)]">
                      {moderationCase.reportCount}{" "}
                      {moderationCase.reportCount === 1 ? "report" : "reports"} ·{" "}
                      <ModerationTime value={moderationCase.createdAt} />
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>

        <form onSubmit={openCase} className="space-y-2">
          <label className="block text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
            Reason for opening a case
            <textarea
              className={`${controlClass} min-h-20 normal-case`}
              rows={3}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <p className="text-xs text-[color:var(--rs-text-muted)]">
            Opens a case on this whole account. If it already has an open or reviewed case, that
            case opens instead.
          </p>
          <ActionButton intent="secondary" loading={opening} type="submit">
            Open a case
          </ActionButton>
        </form>
        {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}
      </div>
    </Panel>
  );
}
