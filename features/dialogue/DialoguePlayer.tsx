"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import type { DialogueSequence } from "@/game/content/dialogue";
import { resolveDialogueSpeaker } from "@/game/content/dialogue";
import { DialogueScene } from "./DialogueScene";

const CHARACTER_REVEAL_MS = 20;

export function DialoguePlayer({
  sequence,
  onAction,
  actionBusy = false,
  actionMessage,
  onClose,
  triggerRef,
}: {
  sequence: DialogueSequence;
  onAction?: () => void;
  actionBusy?: boolean;
  actionMessage?: string;
  onClose: () => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [beatIndex, setBeatIndex] = useState(0);
  const [revealedChars, setRevealedChars] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [restartGeneration, setRestartGeneration] = useState(0);
  const [portraitGeneration, setPortraitGeneration] = useState(0);
  const viewedBeats = useRef(new Set<number>());
  const previousSequenceId = useRef(sequence.id);
  const beat = sequence.beats[beatIndex] ?? sequence.beats[0];

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const sequenceChanged = previousSequenceId.current !== sequence.id;
    previousSequenceId.current = sequence.id;
    viewedBeats.current.clear();
    setBeatIndex(0);
    setRevealedChars(0);
    setRestartGeneration((generation) => generation + 1);
    if (sequenceChanged) {
      setPortraitGeneration((generation) => generation + 1);
    }
  }, [sequence.id]);

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
  const resolvedSpeaker = resolveDialogueSpeaker(beat);
  if (!resolvedSpeaker) return null;

  const currentBeatTextLength = beatCharacters.length;
  const isComplete = reducedMotion || revealedChars >= currentBeatTextLength;
  const isLastBeat = beatIndex === sequence.beats.length - 1;
  const nextLabel = isComplete && isLastBeat ? "Finish" : "Next";
  const actionLabel = sequence.action === "accept_mission" ? "Accept mission" : "Claim Cutter";
  const visibleText = reducedMotion ? beat.text : beatCharacters.slice(0, revealedChars).join("");

  function restart() {
    viewedBeats.current.clear();
    setBeatIndex(0);
    setRevealedChars(0);
    setRestartGeneration((generation) => generation + 1);
    setPortraitGeneration((generation) => generation + 1);
  }

  function goBack() {
    if (beatIndex === 0) return;
    const previousIndex = beatIndex - 1;
    viewedBeats.current.add(previousIndex);
    setBeatIndex(previousIndex);
    setRevealedChars(Array.from(sequence.beats[previousIndex]?.text ?? "").length);
  }

  function goNext() {
    if (!isComplete) {
      setRevealedChars(currentBeatTextLength);
      return;
    }
    if (isLastBeat) {
      onClose();
      return;
    }
    viewedBeats.current.add(beatIndex);
    setRevealedChars(0);
    setBeatIndex((index) => index + 1);
  }

  return (
    <Drawer
      label={`${resolvedSpeaker.npc.displayName} dialogue`}
      title={resolvedSpeaker.npc.displayName}
      eyebrow="Story dialogue"
      onClose={onClose}
      triggerRef={triggerRef}
      size="wide"
    >
      <div className="mt-4">
        <DialogueScene
          actionMessage={actionMessage}
          beat={beat}
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
                <ActionButton disabled={beatIndex === 0} intent="secondary" onClick={goBack}>
                  Back
                </ActionButton>
                {sequence.action && isLastBeat && isComplete ? (
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
    </Drawer>
  );
}
