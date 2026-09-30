"use client";

import { Feedback } from "@/components/ui/Feedback";
import { MODERATION_CASE_STATUS_LABEL, type ModerationCaseStatus } from "@/game/domain/moderation";
import { setModerationCaseStatusAction } from "@/server/moderation-actions";
import { ConfirmAction } from "../ConfirmAction";
import { useModerationMutation } from "./useModerationMutation";

/** The status moves the console offers from each status; the server allows any. */
const MOVES: Record<
  ModerationCaseStatus,
  { to: ModerationCaseStatus; label: string; intent: "danger" | "secondary" }[]
> = {
  open: [
    { to: "reviewed", label: "Mark Reviewed", intent: "secondary" },
    { to: "actioned", label: "Mark Actioned", intent: "secondary" },
    { to: "dismissed", label: "Dismiss case", intent: "danger" },
  ],
  reviewed: [
    { to: "actioned", label: "Mark Actioned", intent: "secondary" },
    { to: "dismissed", label: "Dismiss case", intent: "danger" },
    { to: "open", label: "Reopen", intent: "secondary" },
  ],
  actioned: [{ to: "open", label: "Reopen", intent: "secondary" }],
  dismissed: [{ to: "open", label: "Reopen", intent: "secondary" }],
};

/** Case status controls: each move confirms before committing. */
export function CaseStatusControls({
  caseId,
  status,
}: {
  caseId: string;
  status: ModerationCaseStatus;
}) {
  const { feedback, run } = useModerationMutation();
  return (
    <div>
      <div className="flex flex-wrap items-start gap-2">
        {MOVES[status].map((move) => (
          <ConfirmAction
            key={move.to}
            label={move.label}
            confirmLabel={move.label}
            intent={move.intent}
            prompt={`Move this case from ${MODERATION_CASE_STATUS_LABEL[status]} to ${MODERATION_CASE_STATUS_LABEL[move.to]}?`}
            onConfirm={async () => {
              await run(
                () => setModerationCaseStatusAction({ caseId, status: move.to }),
                `Case is now ${MODERATION_CASE_STATUS_LABEL[move.to]}.`,
              );
            }}
          />
        ))}
      </div>
      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}
    </div>
  );
}
