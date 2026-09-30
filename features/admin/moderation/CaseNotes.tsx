"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { CASE_NOTE_MAX_LENGTH } from "@/game/domain/moderation";
import type { ModerationCaseView } from "@/game/schemas/moderation";
import { addModerationCaseNoteAction } from "@/server/moderation-actions";
import { controlClass, Id, ModerationTime } from "./ModerationParts";
import { useModerationMutation } from "./useModerationMutation";

/** Internal operator notes on a case, with an add-note form. */
export function CaseNotes({
  caseId,
  notes,
}: {
  caseId: string;
  notes: ModerationCaseView["notes"];
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const { feedback, run } = useModerationMutation();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const ok = await run(() => addModerationCaseNoteAction({ caseId, body }), "Note added.");
    setPending(false);
    if (ok) setBody("");
  }

  return (
    <>
      {notes.length === 0 ? (
        <p className="text-[color:var(--rs-text-muted)]">No notes yet.</p>
      ) : (
        <ol aria-label="Case notes" className="space-y-2">
          {notes.map((note) => (
            <li
              key={note.noteId}
              className="min-w-0 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] px-3 py-2"
            >
              <p className="whitespace-pre-wrap break-words text-[color:var(--rs-text-primary)]">
                {note.body}
              </p>
              <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
                <Id value={note.adminUserId} /> · <ModerationTime value={note.createdAt} />
              </p>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={submit}>
        <label className="block text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
          Note
          <textarea
            className={`${controlClass} min-h-24 normal-case`}
            value={body}
            rows={3}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
          Internal only, up to {CASE_NOTE_MAX_LENGTH.toLocaleString("en-US")} characters. Players
          never see notes.
        </p>
        <ActionButton className="mt-2" intent="secondary" loading={pending} type="submit">
          Add note
        </ActionButton>
        {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}
      </form>
    </>
  );
}
