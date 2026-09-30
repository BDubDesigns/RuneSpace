"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import type { RetainedChatView } from "@/game/schemas/moderation";
import {
  loadRetainedPublicChatAction,
  loadRetainedWhispersAction,
} from "@/server/moderation-actions";
import { ModerationTime, PreservedMessageRow } from "./ModerationParts";

type Kind = "public" | "whispers";

/**
 * Retained chat for one report. Nothing loads until the operator presses a
 * button, and each load is recorded in the privileged access log; the server
 * bounds the window (±12h around the report) and the message count.
 */
export function RetainedChatPanel({ caseId, reportId }: { caseId: string; reportId: string }) {
  const [loading, setLoading] = useState<Kind | null>(null);
  const [results, setResults] = useState<Partial<Record<Kind, RetainedChatView>>>({});
  const [error, setError] = useState<string | null>(null);

  async function load(kind: Kind) {
    setLoading(kind);
    setError(null);
    try {
      const request = { caseId, reportId };
      const result =
        kind === "public"
          ? await loadRetainedPublicChatAction(request)
          : await loadRetainedWhispersAction(request);
      if ("error" in result) setError(result.error);
      else setResults((previous) => ({ ...previous, [kind]: result }));
    } catch {
      setError("The request failed. Try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <ActionButton
            className="w-full"
            intent="secondary"
            loading={loading === "public"}
            disabled={loading !== null}
            onClick={() => load("public")}
          >
            Load retained General/Trade (±12h)
          </ActionButton>
          <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
            Loading is recorded in the privileged access log.
          </p>
        </div>
        <div>
          <ActionButton
            className="w-full"
            intent="secondary"
            loading={loading === "whispers"}
            disabled={loading !== null}
            onClick={() => load("whispers")}
          >
            Load retained Whispers between these two accounts (±12h)
          </ActionButton>
          <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
            Loading is recorded in the privileged access log.
          </p>
        </div>
      </div>
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      {results.public ? (
        <RetainedResult title="Retained General/Trade" view={results.public} />
      ) : null}
      {results.whispers ? (
        <RetainedResult title="Retained Whispers" view={results.whispers} />
      ) : null}
    </div>
  );
}

/** One loaded window: its bounds, a truncation notice, and the messages. */
function RetainedResult({ title, view }: { title: string; view: RetainedChatView }) {
  return (
    <div aria-label={title} role="group" className="space-y-2">
      <p className="text-xs text-[color:var(--rs-text-secondary)]">
        <span className="font-semibold">{title}</span> · window <ModerationTime value={view.from} />{" "}
        to <ModerationTime value={view.to} /> · {view.messages.length}{" "}
        {view.messages.length === 1 ? "message" : "messages"}
      </p>
      {view.truncated ? (
        <p className="text-xs text-[color:var(--rs-accent-mining)]" role="status">
          Truncated: more messages exist in this window than are shown.
        </p>
      ) : null}
      {view.messages.length === 0 ? (
        <p className="text-xs text-[color:var(--rs-text-muted)]">
          No retained messages in this window.
        </p>
      ) : (
        <ol className="space-y-1">
          {view.messages.map((message) => (
            <li key={message.id}>
              <PreservedMessageRow message={message} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
