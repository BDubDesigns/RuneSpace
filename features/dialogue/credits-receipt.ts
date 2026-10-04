import type { ConversationBackgroundId } from "@/game/config/foundations";
import type { DialogueBeat } from "@/game/content/dialogue";

/**
 * The runtime-only Credits receipt beat (#290).
 *
 * This is deliberately NOT a `DialogueBeat`. Authored beats are content: an
 * author can place one anywhere, in any sequence, whether or not anything was
 * paid. A Credits tile must only ever appear from a receipt the server returned
 * for a payment that really committed in that call (`creditsPaid` on the
 * Mission acceptance/completion result, see `resolveMissionSuccessView`), so it
 * exists only at runtime and cannot be authored, stored, or previewed as if it
 * were a transaction. QC Studio therefore never sees it.
 */
export type CreditsReceiptBeat = {
  kind: "credits_receipt";
  amount: number;
  backgroundId: ConversationBackgroundId;
  text: "";
};

/** Everything `DialogueScene` can present: authored beats plus the runtime receipt. */
export type PresentedDialogueBeat = DialogueBeat | CreditsReceiptBeat;

export function creditsReceiptBeat(
  amount: number,
  backgroundId: ConversationBackgroundId,
): CreditsReceiptBeat {
  return { kind: "credits_receipt", amount, backgroundId, text: "" };
}
