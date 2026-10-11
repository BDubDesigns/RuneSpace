import { expect, type Locator } from "@playwright/test";

/**
 * What one in-page step of `playDialogueToText` found: the wanted beat is on
 * screen, an unwanted beat was advanced one step, or there was nothing to do yet.
 */
type DialogueStep = "matched" | "advanced" | "waiting";

/**
 * Step through an open NPC dialogue until the beat showing `pattern` is on
 * screen, and stop ON it.
 *
 * The decision ("is this the beat I want?") and the action ("if not, advance
 * it") happen in ONE synchronous browser step. The earlier per-spec helpers read
 * the text in one Playwright round trip and then looked for the Next button in
 * another; when a Mission report's server response swapped the dialogue to its
 * completion sequence between those two round trips, the helper judged the OLD
 * beat and then advanced the NEW one, silently stepping past the first beat it
 * was looking for (#344 investigation: `thrust-issues` and `wheel-be-right-back`
 * failed once each in a loaded full run, never on rerun). With the check and the
 * click in one task, nothing can land between them, so a beat is never advanced
 * without having been judged first.
 *
 * Matching reads the beat's full text, which the dialogue always carries in its
 * screen-reader copy, so a beat matches as soon as it is shown, mid-typing too.
 * Advancing completes the typing first, then clicks Next: one beat per step.
 * The wait between steps is an auto-retrying poll, not a fixed sleep.
 */
export async function playDialogueToText(dialogue: Locator, pattern: RegExp): Promise<void> {
  await expect
    .poll(
      (): Promise<DialogueStep> =>
        dialogue.evaluate(
          (root, { source, flags }): DialogueStep => {
            const text = root.querySelector<HTMLElement>("[data-dialogue-text]");
            if (text && new RegExp(source, flags).test(text.textContent ?? "")) return "matched";
            const next = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
              (button) => button.textContent?.trim() === "Next" && !button.disabled,
            );
            if (!next) return "waiting";
            text?.click();
            next.click();
            return "advanced";
          },
          { source: pattern.source, flags: pattern.flags },
        ),
      {
        message: `dialogue to reach the beat ${pattern}`,
        intervals: [50, 100, 250],
        timeout: 30_000,
      },
    )
    .toBe("matched");
}
