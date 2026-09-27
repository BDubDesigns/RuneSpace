"use client";

import { useState, useTransition } from "react";
import { usePlay } from "@/features/play/PlayContext";
import type { PlayActionResult } from "@/server/actions";
import type { PlayGameplayState } from "@/server/play";

/**
 * One foreground command at the Fabrication Station (#232), queued through the
 * shared Play command gate exactly as the Workbench's commands are, so a
 * station click can never race a refresh or another surface's command.
 * `describe` turns the server's answer into the one message to show.
 */
export function useStationCommand(describe: (state: PlayGameplayState) => string | undefined) {
  const { acceptState, enqueueForeground, releaseCommand } = usePlay();
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [, startTransition] = useTransition();

  function run(intent: string, command: () => Promise<PlayActionResult>) {
    enqueueForeground(() => {
      setPending(intent);
      startTransition(async () => {
        try {
          const result = await command();
          if (result.error) setMessage(result.error);
          else if (result.state) {
            acceptState(result.state);
            setMessage(describe(result.state));
          }
        } catch {
          setMessage("Comms interruption. The station could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(undefined);
        }
      });
    });
  }

  return { run, pending, message, setMessage };
}
