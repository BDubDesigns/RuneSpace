"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import type { ConversationBackgroundDefinition } from "@/game/content/conversation-backgrounds";
import type { DialogueSequence } from "@/game/content/dialogue";
import type { NpcDefinition } from "@/game/content/npcs";
import { resolveDialogueSpeaker } from "@/game/content/dialogue";

const CHARACTER_REVEAL_MS = 30;

export function DialoguePlayer({
  background,
  npc,
  sequence,
  onAction,
  actionBusy = false,
  actionMessage,
  onClose,
  triggerRef,
}: {
  background: ConversationBackgroundDefinition;
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
    const currentBeat = beat;
    if (!currentBeat) return;
    const textLength = currentBeat.text.length;
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
  const currentBeatTextLength = beat.text.length;
  const isComplete = revealedChars >= beat.text.length;
  const isLastBeat = beatIndex === sequence.beats.length - 1;
  const nextLabel = isComplete && isLastBeat ? "Finish" : "Next";
  const actionLabel = sequence.action === "accept_mission" ? "Accept mission" : "Claim Cutter";

  function restart() {
    viewedBeats.current.clear();
    setBeatIndex(0);
    setRevealedChars(0);
    setRestartGeneration((generation) => generation + 1);
  }

  function goBack() {
    if (beatIndex === 0) return;
    viewedBeats.current.add(beatIndex);
    setBeatIndex((index) => index - 1);
  }

  function goNext() {
    if (!isComplete) {
      setRevealedChars(currentBeatTextLength);
      return;
    }
    if (isLastBeat) return;
    viewedBeats.current.add(beatIndex);
    setRevealedChars(0);
    setBeatIndex((index) => index + 1);
  }

  return (
    <Drawer
      label={`${npc.displayName} dialogue`}
      title={npc.displayName}
      eyebrow="Temporary dialogue draft"
      onClose={onClose}
      triggerRef={triggerRef}
      size="wide"
    >
      <div className="mt-4 overflow-hidden border border-[color:var(--rs-border-structural)] bg-black">
        <div className="relative aspect-[15/8] min-h-56 w-full overflow-hidden sm:min-h-72">
          <Image
            src={background.asset}
            alt={background.alt}
            fill
            sizes="(max-width: 640px) 100vw, 56rem"
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10" />
          <Image
            src={resolvedSpeaker.expressionAsset}
            alt={`${npc.displayName}, ${beat.expressionId} expression`}
            width={400}
            height={500}
            sizes="min(60vw, 24rem)"
            className="absolute inset-x-1/2 bottom-0 h-[92%] w-auto -translate-x-1/2 object-contain"
          />
          <p className="rs-map-plate rs-map-plate--nameplate absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] px-2 py-1 font-display text-xs uppercase tracking-[0.14em]">
            {npc.role}
          </p>
        </div>
        <div className="border-t border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-4 sm:p-5">
          <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
            {npc.displayName}
          </p>
          <button
            type="button"
            className="rs-focus mt-3 block w-full text-left text-base leading-relaxed text-[color:var(--rs-text-primary)]"
            data-dialogue-text
            onClick={() => setRevealedChars(beat.text.length)}
          >
            <span aria-hidden="true">
              {beat.text.slice(0, revealedChars)}
              <span className="ml-0.5 animate-pulse">_</span>
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
