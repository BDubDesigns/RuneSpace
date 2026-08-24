import Image from "next/image";
import type { ReactNode } from "react";
import { getConversationBackground } from "@/game/content/conversation-backgrounds";
import type { DialogueBeat } from "@/game/content/dialogue";
import { resolveDialogueSpeaker } from "@/game/content/dialogue";
import { getLocation } from "@/game/content/locations";

/**
 * Shared RuneSpace dialogue presentation. Gameplay/player state belongs to
 * DialoguePlayer; authoring state belongs to QC Studio. Both surfaces render
 * this same scene so the Studio preview cannot drift from production.
 */
export function DialogueScene({
  beat,
  visibleText = beat.text,
  fullText = beat.text,
  isComplete = true,
  onTextClick,
  portraitGeneration = 0,
  actionMessage,
  controls,
}: {
  beat: DialogueBeat;
  visibleText?: string;
  fullText?: string;
  isComplete?: boolean;
  onTextClick?: () => void;
  portraitGeneration?: number;
  actionMessage?: string;
  controls?: ReactNode;
}) {
  const resolvedSpeaker = resolveDialogueSpeaker(beat);
  const background = getConversationBackground(beat.backgroundId);
  if (!resolvedSpeaker || !background) return null;
  const sceneLocation = getLocation(background.locationId);

  return (
    <div className="overflow-hidden border border-[color:var(--rs-border-structural)] bg-black">
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
        {sceneLocation ? (
          <p
            className="rs-dialogue-scene__plate rs-map-plate left-3 top-3 px-2 py-1 font-display text-xs uppercase tracking-[0.14em]"
            data-dialogue-scene-location
          >
            {sceneLocation.displayName.toUpperCase()}
          </p>
        ) : null}
        {beat.presentationMode === "comms" ? (
          <>
            <div
              aria-hidden="true"
              className="rs-dialogue-scene__comms-overlay pointer-events-none absolute inset-0 z-30"
            />
            <p className="rs-dialogue-scene__plate rs-dialogue-scene__comms-label rs-map-plate bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-1 font-display text-xs uppercase tracking-[0.14em]">
              COMMS LINK
            </p>
          </>
        ) : null}
        <Image
          key={`${beat.speakerNpcId}:${portraitGeneration}`}
          src={resolvedSpeaker.expressionAsset}
          alt={`${resolvedSpeaker.npc.displayName}, ${beat.expressionId} expression`}
          width={400}
          height={500}
          sizes="min(60vw, 24rem)"
          className="rs-dialogue-scene__npc absolute inset-x-1/2 bottom-0 z-20 h-[92%] w-auto -translate-x-1/2 object-contain"
          data-portrait-transition="fade-in"
        />
      </div>
      <div className="border-t border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-4 sm:p-5">
        <div>
          <p
            className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]"
            data-dialogue-speaker-name
          >
            {resolvedSpeaker.npc.displayName}
          </p>
          <p className="mt-1 text-sm text-[color:var(--rs-text-muted)]" data-dialogue-speaker-role>
            {resolvedSpeaker.npc.role}
          </p>
        </div>
        <button
          type="button"
          className="rs-focus mt-3 block w-full text-left text-base leading-relaxed text-[color:var(--rs-text-primary)]"
          data-dialogue-text
          onClick={onTextClick}
        >
          <span aria-hidden="true">
            {visibleText}
            {!isComplete ? <span className="rs-dialogue-cursor ml-0.5">_</span> : null}
          </span>
          <span className="sr-only" aria-live="polite" aria-atomic="true">
            {fullText}
          </span>
        </button>
        {actionMessage ? (
          <p
            className="mt-3 border border-[color:var(--rs-accent-warning)] bg-[color:var(--rs-surface-raised)] p-3 text-sm text-[color:var(--rs-accent-warning)]"
            role="status"
          >
            {actionMessage}
          </p>
        ) : null}
        {controls ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">{controls}</div>
        ) : null}
      </div>
    </div>
  );
}
