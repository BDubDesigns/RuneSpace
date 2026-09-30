"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { chatMessageLength } from "@/game/domain/chat";
import { APPEAL_POLICY } from "@/game/domain/moderation";
import type { SanctionNoticeView } from "@/game/schemas/moderation";
import { submitModerationAppealAction } from "@/server/actions";
import { appealStatusLabel, unappealableReason } from "./notice-format";

/**
 * The appeal area of a notice page (issue #248): the form while the notice can
 * still be appealed, otherwise the appeal's status or why there is nothing to
 * appeal. Whether a notice is appealable is the server's call (`appealable`);
 * this only renders it and the server re-checks on submit. An appeal is text
 * only, up to `APPEAL_POLICY.bodyMaxLength` characters, and never names who
 * reported or reviewed the notice.
 */
export function AppealSection({ notice: initial }: { notice: SanctionNoticeView }) {
  const router = useRouter();
  const [notice, setNotice] = useState(initial);
  const [submitted, setSubmitted] = useState(false);

  if (notice.appealable) {
    return (
      <AppealForm
        notice={notice}
        onSubmitted={(next) => {
          setNotice(next);
          setSubmitted(true);
          // Refresh the server-rendered facts above (the Appeal line).
          router.refresh();
        }}
      />
    );
  }

  return (
    <section aria-labelledby="appeal-status-heading" className="mt-6" data-appeal-status="">
      <h2
        className="font-display text-lg font-bold text-[color:var(--rs-text-primary)]"
        id="appeal-status-heading"
      >
        Appeal status
      </h2>
      {submitted ? (
        <Feedback tone="success">
          Appeal submitted. A moderator will read it and the result will show here.
        </Feedback>
      ) : null}
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        {notice.appeal.status === "none"
          ? unappealableReason(notice.state)
          : appealStatusLabel(notice.appeal)}
      </p>
    </section>
  );
}

function AppealForm({
  notice,
  onSubmitted,
}: {
  notice: SanctionNoticeView;
  onSubmitted: (notice: SanctionNoticeView) => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const length = chatMessageLength(body.trim());
  const max = APPEAL_POLICY.bodyMaxLength;
  const overLimit = length > max;
  const canSubmit = length > 0 && !overLimit && !sending;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    setError(undefined);
    let result: Awaited<ReturnType<typeof submitModerationAppealAction>>;
    try {
      result = await submitModerationAppealAction({ sanctionId: notice.sanctionId, body });
    } catch {
      result = { error: "Appeal not sent. Check your connection and try again." };
    }
    setSending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSubmitted(result.notice);
  }

  return (
    <section aria-labelledby="appeal-heading" className="mt-6" data-appeal-form="">
      <h2
        className="font-display text-lg font-bold text-[color:var(--rs-text-primary)]"
        id="appeal-heading"
      >
        Appeal this decision
      </h2>
      <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
        Tell us briefly why you think this should be reviewed. A moderator will read it. You can
        appeal each notice once.
      </p>
      <form className="mt-3 space-y-2" onSubmit={(event) => void submit(event)}>
        <label
          className="block text-sm font-medium text-[color:var(--rs-text-primary)]"
          htmlFor="appeal-body"
        >
          Why should we review this?
        </label>
        <textarea
          aria-describedby="appeal-counter"
          aria-invalid={overLimit || undefined}
          className="rs-bevel rs-focus block min-h-32 w-full resize-y border bg-[color:var(--rs-surface-control)] px-3 py-2 text-sm text-[color:var(--rs-text-primary)] placeholder:text-[color:var(--rs-text-muted)] focus:border-[color:var(--rs-accent-primary)]"
          id="appeal-body"
          name="body"
          onChange={(event) => setBody(event.target.value)}
          rows={6}
          value={body}
        />
        <p
          className={`text-right text-xs tabular-nums ${overLimit ? "text-[color:var(--rs-accent-danger)]" : "text-[color:var(--rs-text-muted)]"}`}
          data-appeal-counter=""
          id="appeal-counter"
        >
          {overLimit ? `${length - max} over the ${max}-character limit` : `${length}/${max}`}
        </p>
        <ActionButton className="w-full" disabled={!canSubmit} loading={sending} type="submit">
          Submit appeal
        </ActionButton>
        {error ? <Feedback tone="danger">{error}</Feedback> : null}
      </form>
    </section>
  );
}
