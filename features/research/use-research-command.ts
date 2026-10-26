"use client";

import { useState, useTransition } from "react";
import { usePlay } from "@/features/play/PlayContext";
import type { ResearchActionResult } from "@/server/actions";
import type { ResearchCommandOutcome } from "@/server/research-job-commands";

/**
 * One foreground research command (#406), queued through the shared Play command
 * gate exactly as every other station command is, so a click can never race a
 * refresh or another surface's command.
 *
 * Not optimistic: the surfaces change only when the authoritative state comes
 * back through `acceptState`. A refusal keeps the previous state and reports the
 * server's own words through `message`; `onDone` receives the outcome of any
 * command that reached the server, so the caller can present what happened.
 */
export function useResearchCommand() {
  const { acceptState, enqueueForeground, releaseCommand } = usePlay();
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [, startTransition] = useTransition();

  function run(
    intent: string,
    command: () => Promise<ResearchActionResult>,
    onDone?: (outcome: ResearchCommandOutcome) => void,
  ) {
    enqueueForeground(() => {
      setPending(intent);
      setMessage(undefined);
      startTransition(async () => {
        try {
          const result = await command();
          if ("error" in result) {
            setMessage(result.error);
            return;
          }
          acceptState(result.state);
          if (result.research.status === "refused") setMessage(result.research.message);
          onDone?.(result.research);
        } catch {
          setMessage("Comms interruption. The assignment could not be confirmed; try again.");
        } finally {
          setPending(undefined);
          releaseCommand();
        }
      });
    });
  }

  return { run, pending, message, setMessage };
}
