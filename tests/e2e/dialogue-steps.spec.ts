import { expect, test, type Page } from "@playwright/test";
import { playDialogueToText } from "./dialogue-steps";

/**
 * The dialogue-stepping helper itself, against a mock of the real dialogue's
 * contract (#344 investigation): a `[data-dialogue-text]` button holding a
 * visible copy plus a full screen-reader copy, a Next button that first
 * completes the typing and then advances, a last-beat Finish, and a sequence
 * that can be swapped for another (a Mission report's completion) at any moment.
 *
 * It needs no application, database or account: it proves the helper never
 * advances a beat it has not judged, which a real run can only show by luck.
 */

const HARNESS = `
<div role="dialog" aria-label="Mock conversation" id="root">
  <button type="button" data-dialogue-text><span aria-hidden="true" id="visible"></span><span class="sr-only" id="full"></span></button>
  <button type="button" id="next"></button>
</div>
<script>
  // Like the real player, the two buttons persist and are updated in place, and
  // every handler reads the CURRENT state when it runs.
  let beats = [];
  let index = 0;
  let typed = 0;
  const render = () => {
    const beat = beats[index] ?? "";
    const complete = typed >= beat.length;
    document.getElementById("visible").textContent = beat.slice(0, typed);
    document.getElementById("full").textContent = beat;
    document.getElementById("next").textContent =
      complete && index === beats.length - 1 ? "Finish" : "Next";
  };
  document.querySelector("[data-dialogue-text]").onclick = () => {
    typed = (beats[index] ?? "").length;
    render();
  };
  document.getElementById("next").onclick = () => {
    const beat = beats[index] ?? "";
    if (typed < beat.length) typed = beat.length;
    else if (index < beats.length - 1) { index += 1; typed = 0; }
    render();
  };
  window.present = (next) => { beats = next; index = 0; typed = 0; render(); };
</script>`;

async function open(page: Page, beats: string[]) {
  await page.setContent(HARNESS);
  await page.evaluate(
    (initial) => (window as never as { present(b: string[]): void }).present(initial),
    beats,
  );
  return page.getByRole("dialog", { name: "Mock conversation" });
}

test("stops on the first beat that matches, even mid-typing, and does not advance it", async ({
  page,
}) => {
  const dialogue = await open(page, ["Opening line.", "Wanted line.", "Closing line."]);
  await playDialogueToText(dialogue, /Wanted line\./);
  await expect(dialogue.locator("[data-dialogue-text]")).toContainText("Wanted line.");
  // Idempotent: asking again for the beat on screen leaves it there.
  await playDialogueToText(dialogue, /Wanted line\./);
  await expect(dialogue.locator("[data-dialogue-text]")).toContainText("Wanted line.");
  await expect(dialogue.locator("[data-dialogue-text]")).not.toContainText("Closing line.");
});

test("steps over beats it does not want, one beat per step, up to the last beat", async ({
  page,
}) => {
  const dialogue = await open(page, ["One.", "Two.", "Three."]);
  await playDialogueToText(dialogue, /Three\./);
  await expect(dialogue.locator("[data-dialogue-text]")).toContainText("Three.");
});

test("never skips the first beat of a sequence that is swapped in while it polls", async ({
  page,
}) => {
  // The first beat of the incoming sequence must be judged before it can be
  // advanced, however the swap lines up with the helper's steps. Each round
  // lands the swap at a different moment (0-19 ms into the poll).
  for (let round = 0; round < 20; round += 1) {
    const dialogue = await open(page, ["Mounts seated. Good."]);
    // The swap is scheduled inside the page, so it lands on its own clock.
    await page.evaluate((delay) => {
      setTimeout(
        () =>
          (window as never as { present(b: string[]): void }).present([
            "First report beat.",
            "Second report beat.",
          ]),
        delay,
      );
    }, round);
    await playDialogueToText(dialogue, /First report beat\./);
    await expect(dialogue.locator("[data-dialogue-text]")).toContainText("First report beat.");
    await expect(dialogue.locator("[data-dialogue-text]")).not.toContainText("Second report beat.");
  }
});
