"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ModerationActionResult } from "@/server/moderation-actions";

export type MutationFeedback = { text: string; tone: "success" | "danger" | "muted" };

/**
 * Runs one moderation server action for the case page: an error shows as
 * danger feedback, success (or an honest "nothing changed") shows a status,
 * and either way a success refreshes the server-rendered case so it always
 * shows persisted state.
 */
export function useModerationMutation() {
  const router = useRouter();
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);

  async function run(
    action: () => Promise<ModerationActionResult>,
    successText: string,
  ): Promise<boolean> {
    setFeedback(null);
    let result: ModerationActionResult;
    try {
      result = await action();
    } catch {
      setFeedback({ text: "The request failed. Try again.", tone: "danger" });
      return false;
    }
    if ("error" in result) {
      setFeedback({ text: result.error, tone: "danger" });
      return false;
    }
    setFeedback(
      result.changed
        ? { text: successText, tone: "success" }
        : { text: "Nothing changed.", tone: "muted" },
    );
    router.refresh();
    return true;
  }

  return { feedback, run };
}
