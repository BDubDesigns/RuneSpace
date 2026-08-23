"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import {
  getConversationBackground,
  type ConversationBackgroundDefinition,
} from "@/game/content/conversation-backgrounds";
import type { DialogueSequence } from "@/game/content/dialogue";
import type { NpcDefinition } from "@/game/content/npcs";
import { resolveDialogueSpeaker } from "@/game/content/dialogue";

const CHARACTER_REVEAL_MS = 20;

export function DialoguePlayer({
  npc,
  sequence,
  onAction,
  actionBusy = false,
  actionMessage,
  onClose,
  triggerRef,
}: {
  npc: NpcDefinition;
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
  const viewedBeats = useRef(new Set<number>());
  const beat = sequence.beats[beatIndex] ?? sequence.beats[0];

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    viewedBeats.current.clear();
    setBeatIndex(0);
    setRevealedChars(0);
    setRestartGeneration((generation) => generation + 1);
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
  const background: ConversationBackgroundDefinition | undefined = getConversationBackground(
    beat.backgroundId,
  );
  if (!resolvedSpeaker || !background) return null;

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
      label={`${npc.displayName} dialogue`}
      title={npc.displayName}
      eyebrow="Story dialogue"
      onClose={onClose}
      triggerRef={triggerRef}
      size="wide"
    >
      <div className="mt-4 overflow-hidden border border-[color:var(--rs-border-structural)] bg-black">
        <div
          className="rs-dialogue-scene relative aspect-[15/8] min-h-56 w-full overflow-hidden sm:min-h-72"
          data-dialogue-presentation={beat.presentationMode}
          data-presentation-mode={beat.presentationMode}
        >
          <Image
            src={background.asset}
            alt={background.alt}
            fill
            sizes="(max-width: 640px) 100vw, 56rem"
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/50 via-transparent to-black/10" />
          {beat.presentationMode === "comms" ? (
            <>
              <div
                aria-hidden="true"
                className="rs-dialogue-scene__comms-overlay pointer-events-none absolute inset-0 z-10"
              />
              <p className="rs-dialogue-scene__comms-label rs-map-plate absolute left-3 top-3 z-30 px-2 py-1 font-display text-xs uppercase tracking-[0.14em]">
                COMMS LINK
              </p>
            </>
          ) : null}
          <Image
            src={resolvedSpeaker.expressionAsset}
            alt={`${resolvedSpeaker.npc.displayName}, ${beat.expressionId} expression`}
            width={400}
            height={500}
            sizes="min(60vw, 24rem)"
            className="rs-dialogue-scene__npc absolute inset-x-1/2 bottom-0 z-20 h-[92%] w-auto -translate-x-1/2 object-contain"
          />
          <p className="rs-map-plate rs-map-plate--nameplate absolute bottom-3 left-3 z-30 max-w-[calc(100%-1.5rem)] px-2 py-1 font-display text-xs uppercase tracking-[0.14em]">
            {resolvedSpeaker.npc.role}
          </p>
        </div>
        <div className="border-t border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-4 sm:p-5">
          <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
            {resolvedSpeaker.npc.displayName}
          </p>
          <button
            type="button"
            className="rs-focus mt-3 block w-full text-left text-base leading-relaxed text-[color:var(--rs-text-primary)]"
            data-dialogue-text
            onClick={() => setRevealedChars(currentBeatTextLength)}
          >
            <span aria-hidden="true">
              {visibleText}
              {!isComplete ? <span className="rs-dialogue-cursor ml-0.5">_</span> : null}
            </span>
            <span className="sr-only" aria-live="polite" aria-atomic="true">
              {beat.text}
            </span>
          </button>
          {actionMessage ? (
            <p className="border-[color:var(--rs-accent-warning)]/50 mt-3 border bg-[color:var(--rs-surface-raised)] p-3 text-sm text-[color:var(--rs-accent-warning)]">
              {actionMessage}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
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
          </div>
        </div>
      </div>
    </Drawer>
  );
}
