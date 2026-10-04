"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import type { ConversationBackgroundId } from "@/game/config/foundations";
import { resolveConversationBackgroundId } from "@/game/content/conversation-backgrounds";
import type { DialogueSequence } from "@/game/content/dialogue";
import type { CreditsReceipt } from "@/game/domain/conversation";
import { resolveDialogueItem, resolveDialogueSpeaker } from "@/game/content/dialogue";
import { creditsReceiptBeat, type PresentedDialogueBeat } from "./credits-receipt";
import { DialogueScene } from "./DialogueScene";

const CHARACTER_REVEAL_MS = 20;

/**
 * Plays one authored dialogue sequence inside the NPC conversation surface.
 *
 * The player is presentation only. It never decides which sequence is relevant
 * and never owns Mission authority: the conversation hub selects the sequence,
 * and the optional terminal control's copy and command come from Mission-derived
 * conversation metadata (`game/domain/conversation.ts`).
 *
 * `onBack` from the first beat and `onFinish` on the last beat both return to
 * the conversation hub; dismissing the surface is the hosting drawer's job.
 *
 * `venueBackgroundId` is the one presentation detail this player resolves: a
 * sequence authored as a present-tense local conversation is shown against the
 * venue the speaker is standing in now. It is applied to local NPC beats only,
 * so an authored comms call and every scene that happened somewhere specific
 * keep the background they were written against (#190).
 *
 * `completedRepairTargetIds` is the other: a background authored with a
 * `repaired` variant is shown as that variant once its repair is finished
 * (#292), so a room the player rebuilt is presented as rebuilt in every beat
 * set there, replayable topics included. It is applied after the venue, so
 * the two never undo each other.
 *
 * `receipt` is the confirmed Credits payout the server just reported for the
 * command that opened this sequence (#290). It is presented as a runtime-only
 * reward tile in front of the authored beats (`leads`, after the sequence's
 * `creditsReceiptAfterBeats` opening lines when it authors any) or as the
 * whole scene (`stands_alone`), against the neighbouring authored beat's background so the
 * tile never changes where the conversation is. The authored beats themselves
 * are never replaced or reordered.
 */
export function DialoguePlayer({
  sequence,
  actionLabel,
  onAction,
  actionBusy = false,
  actionMessage,
  onBack,
  onFinish,
  venueBackgroundId,
  completedRepairTargetIds,
  receipt,
}: {
  sequence: DialogueSequence;
  /** Present only when this conversation genuinely drives a Mission command now. */
  actionLabel?: string;
  onAction?: () => void;
  actionBusy?: boolean;
  actionMessage?: string;
  onBack: () => void;
  onFinish: () => void;
  /** Where this NPC is standing now; only read by `presentsAtCurrentVenue`. */
  venueBackgroundId?: ConversationBackgroundId;
  /** Repairs this character has finished; only read by `repaired` backgrounds. */
  completedRepairTargetIds?: ReadonlySet<string>;
  receipt?: CreditsReceipt;
}) {
  const [beatIndex, setBeatIndex] = useState(0);
  const [revealedChars, setRevealedChars] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [restartGeneration, setRestartGeneration] = useState(0);
  const [portraitGeneration, setPortraitGeneration] = useState(0);
  // A receipt is part of what is presented, so the same sequence shown with and
  // without one (or with a different one) is a different presentation.
  const presentationKey = receipt
    ? `${sequence.id}:receipt:${receipt.placement}:${receipt.amount}`
    : sequence.id;
  const [presentedSequenceId, setPresentedSequenceId] = useState(presentationKey);
  const viewedBeats = useRef(new Set<number>());

  // A new sequence starts at its first beat in the same render that presents
  // it. Resetting from an effect instead let one commit show the previous
  // sequence's beat index against the new sequence's beats (#243).
  if (presentedSequenceId !== presentationKey) {
    setPresentedSequenceId(presentationKey);
    setBeatIndex(0);
    setRevealedChars(0);
    setRestartGeneration((generation) => generation + 1);
    setPortraitGeneration((generation) => generation + 1);
  }

  const receiptAmount = receipt?.amount;
  const receiptPlacement = receipt?.placement;
  // Stable between renders: the reveal effect below depends on the beat object.
  const beats = useMemo(
    () =>
      presentedBeats(
        sequence,
        receiptAmount !== undefined && receiptPlacement
          ? { amount: receiptAmount, placement: receiptPlacement }
          : undefined,
        venueBackgroundId,
        completedRepairTargetIds,
      ),
    [sequence, receiptAmount, receiptPlacement, venueBackgroundId, completedRepairTargetIds],
  );
  const beat = beats[beatIndex] ?? beats[0];

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    viewedBeats.current.clear();
  }, [presentationKey]);

  const beatCharacters = beat ? Array.from(beat.text) : [];

  useEffect(() => {
    if (!beat) return;
    const textLength = Array.from(beat.text).length;
    if (reducedMotion || viewedBeats.current.has(beatIndex)) {
      setRevealedChars(textLength);
      return;
    }
    if (revealedChars >= textLength) return;
    const timer = window.setTimeout(
      () => setRevealedChars((current) => Math.min(textLength, current + 1)),
      CHARACTER_REVEAL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [beat, beatIndex, reducedMotion, revealedChars, restartGeneration]);

  if (!beat) return null;
  if (beat.kind !== "credits_receipt") {
    const resolvedSpeaker = resolveDialogueSpeaker(beat);
    const resolvedItem = resolveDialogueItem(beat);
    if (!resolvedSpeaker && !resolvedItem && beat.kind !== "skill_xp") return null;
  }

  const currentBeatTextLength = beatCharacters.length;
  const isComplete = reducedMotion || revealedChars >= currentBeatTextLength;
  const isLastBeat = beatIndex === beats.length - 1;
  const nextLabel = isComplete && isLastBeat ? "Finish" : "Next";
  const visibleText = reducedMotion ? beat.text : beatCharacters.slice(0, revealedChars).join("");

  function restart() {
    viewedBeats.current.clear();
    setBeatIndex(0);
    setRevealedChars(0);
    setRestartGeneration((generation) => generation + 1);
    setPortraitGeneration((generation) => generation + 1);
  }

  function goBack() {
    if (beatIndex === 0) {
      onBack();
      return;
    }
    const previousIndex = beatIndex - 1;
    viewedBeats.current.add(previousIndex);
    setBeatIndex(previousIndex);
    setRevealedChars(Array.from(beats[previousIndex]?.text ?? "").length);
  }

  function goNext() {
    if (!isComplete) {
      setRevealedChars(currentBeatTextLength);
      return;
    }
    if (isLastBeat) {
      onFinish();
      return;
    }
    viewedBeats.current.add(beatIndex);
    setRevealedChars(0);
    setBeatIndex((index) => index + 1);
  }

  return (
    <div className="mt-4" data-dialogue-player={sequence.id}>
      <DialogueScene
        actionMessage={actionMessage}
        beat={beat}
        beatIndex={beatIndex}
        controls={
          <>
            <ActionButton
              aria-label="Restart dialogue"
              className="px-3"
              intent="secondary"
              onClick={restart}
            >
              ↻ <span className="sr-only">Restart dialogue</span>
            </ActionButton>
            <div className="flex flex-wrap justify-end gap-2">
              <ActionButton
                aria-label={beatIndex === 0 ? "Back to conversation topics" : "Back"}
                data-dialogue-back
                intent="secondary"
                onClick={goBack}
              >
                Back
              </ActionButton>
              {actionLabel && isLastBeat && isComplete ? (
                <ActionButton
                  data-dialogue-action
                  disabled={actionBusy}
                  loading={actionBusy}
                  intent="primary"
                  onClick={onAction}
                >
                  {actionLabel}
                </ActionButton>
              ) : (
                <ActionButton data-dialogue-next intent="primary" onClick={goNext}>
                  {nextLabel}
                </ActionButton>
              )}
            </div>
          </>
        }
        isComplete={isComplete}
        onTextClick={() => setRevealedChars(currentBeatTextLength)}
        portraitGeneration={portraitGeneration}
        visibleText={visibleText}
      />
    </div>
  );
}

/**
 * The beats the player steps through. The venue background is applied to local
 * NPC beats of a present-tense sequence (#190), and a Credits receipt borrows
 * the background of the authored beat it sits next to — the first beat when it
 * leads, the last when it stands alone — so it is always shown where that
 * conversation is happening.
 */
export function presentedBeats(
  sequence: DialogueSequence,
  receipt: CreditsReceipt | undefined,
  venueBackgroundId: ConversationBackgroundId | undefined,
  completedRepairTargetIds: ReadonlySet<string> = new Set(),
): readonly PresentedDialogueBeat[] {
  const authored = sequence.beats.map((beat) => {
    const placed =
      sequence.presentsAtCurrentVenue &&
      venueBackgroundId &&
      beat.kind === "npc" &&
      beat.presentationMode === "local"
        ? { ...beat, backgroundId: venueBackgroundId }
        : beat;
    const backgroundId = resolveConversationBackgroundId(
      placed.backgroundId,
      completedRepairTargetIds,
    );
    return backgroundId === placed.backgroundId ? placed : { ...placed, backgroundId };
  });
  if (!receipt) return authored;
  if (receipt.placement === "stands_alone") {
    const last = authored[authored.length - 1];
    return last ? [creditsReceiptBeat(receipt.amount, last.backgroundId)] : authored;
  }
  // A leading tile normally opens the sequence; a sequence whose speaker hands
  // the money over in an opening line places it right after that line (#292).
  const at = Math.min(sequence.creditsReceiptAfterBeats ?? 0, authored.length);
  const neighbour = at > 0 ? authored[at - 1] : authored[0];
  if (!neighbour) return authored;
  const tile = creditsReceiptBeat(receipt.amount, neighbour.backgroundId);
  return [...authored.slice(0, at), tile, ...authored.slice(at)];
}
