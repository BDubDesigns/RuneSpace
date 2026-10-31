import Image from "next/image";
import type { ReactNode, RefObject } from "react";
import {
  getConversationBackground,
  getConversationBackgroundPlaceName,
} from "@/game/content/conversation-backgrounds";
import type { DialogueBeat } from "@/game/content/dialogue";
import {
  resolveDialogueItem,
  resolveDialogueSkillXp,
  resolveDialogueSpeaker,
} from "@/game/content/dialogue";
import { SceneComposition } from "@/features/location-scene/SceneComposition";
import { SceneCueStageLayers } from "@/features/scene-cues/SceneCueStageLayers";
import { sceneCueLayerStyle, type SceneCueState } from "@/game/domain/scene-cues";
import { SkillXpTile } from "@/components/items/SkillXpTile";
import { VisualTile } from "@/components/items/VisualTile";
import { CREDITS_CHIP_SRC, CreditsAmount } from "@/components/ui/CreditsAmount";
import { XpAmount } from "@/components/ui/XpAmount";
import type { PresentedDialogueBeat } from "./credits-receipt";

/**
 * Shared RuneSpace dialogue presentation. Gameplay/player state belongs to
 * DialoguePlayer; authoring state belongs to QC Studio. Both surfaces render
 * this same scene so the Studio preview cannot drift from production.
 *
 * A beat presents exactly one subject over the authored conversation
 * background: an NPC portrait, an item reveal, or a skill-XP reward tile.
 * Item and skill-XP beats are presentation only — this scene never grants,
 * removes, or mutates inventory or progression.
 *
 * The one runtime-only subject is the confirmed Credits receipt (#290). It is
 * not an authored `DialogueBeat`: only the conversation surface builds it, from
 * a payout the server reported, so the Studio preview (which renders authored
 * beats) cannot express an unconditional payout.
 */
export function DialogueScene({
  beat,
  visibleText = beat.text,
  fullText = beat.text,
  isComplete = true,
  onTextClick,
  portraitGeneration = 0,
  beatIndex = 0,
  actionMessage,
  controls,
  sceneCues,
}: {
  beat: PresentedDialogueBeat;
  visibleText?: string;
  fullText?: string;
  isComplete?: boolean;
  onTextClick?: () => void;
  portraitGeneration?: number;
  /**
   * The beat's position in its sequence. An item reveal is a discrete
   * moment — unlike an NPC's continued on-screen presence, showing the same
   * item again is still a fresh reveal — so its artwork keys off this rather
   * than off item identity, and always retriggers the fade-in even when two
   * consecutive beats present the same item (#207 follow-up).
   */
  beatIndex?: number;
  actionMessage?: string;
  controls?: ReactNode;
  /**
   * Scene cues (#441): a sequence of authored layer cues is playing, or has just
   * played, over this scene. The frame ref is what the player finds its layers
   * through, and `state` is where the layers rest between and after cues. Absent
   * for every ordinary dialogue, which then renders exactly the elements it always
   * did: the portrait gets no wrapper and the stage no extra layers.
   */
  sceneCues?: { frameRef: RefObject<HTMLDivElement | null>; state: SceneCueState };
}) {
  const authoredBeat: DialogueBeat | undefined = beat.kind === "credits_receipt" ? undefined : beat;
  const resolvedSpeaker = authoredBeat ? resolveDialogueSpeaker(authoredBeat) : undefined;
  const resolvedItem = authoredBeat ? resolveDialogueItem(authoredBeat) : undefined;
  const resolvedSkillXp = authoredBeat ? resolveDialogueSkillXp(authoredBeat) : undefined;
  const background = getConversationBackground(beat.backgroundId);
  if (!background) return null;
  if (beat.kind === "npc" && !resolvedSpeaker) return null;
  if (beat.kind === "item" && !resolvedItem) return null;
  if (beat.kind === "skill_xp" && !resolvedSkillXp) return null;
  const scenePlaceName = getConversationBackgroundPlaceName(beat.backgroundId);
  // Item, XP and Credits reveals are local-scene presentations; they have no comms variant.
  const presentationMode = beat.kind === "npc" ? beat.presentationMode : "local";

  return (
    <div className="overflow-hidden border border-[color:var(--rs-border-structural)] bg-black">
      <div
        ref={sceneCues?.frameRef}
        className="rs-dialogue-scene relative aspect-[15/8] min-h-56 w-full overflow-hidden sm:min-h-72"
        data-dialogue-presentation={presentationMode}
        data-presentation-mode={presentationMode}
        data-dialogue-subject={beat.kind}
        data-dialogue-background={beat.backgroundId}
      >
        {background.composition ? (
          // A layered scene (#351) is composed on the same stage the Location header
          // uses, so the ship in a conversation is the ship at its landing mark.
          <SceneComposition
            scene={background.composition}
            sizes="(max-width: 640px) 100vw, 56rem"
            // A 15:8 frame at its widest (56rem) is ~478px tall, so a 4:1 stage is
            // at most ~1912px wide.
            stageWidthHint={1912}
            priority
          >
            {/* Stage-relative cue layers (#441), cropped and placed with the world art. */}
            {sceneCues ? <SceneCueStageLayers state={sceneCues.state} /> : null}
          </SceneComposition>
        ) : (
          <Image
            src={background.asset}
            alt={background.alt}
            fill
            sizes="(max-width: 640px) 100vw, 56rem"
            className="object-cover"
            priority
          />
        )}
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/50 via-transparent to-black/10" />
        {scenePlaceName ? (
          <p
            className="rs-dialogue-scene__plate rs-map-plate left-3 top-3 truncate px-2 py-1 font-display text-xs uppercase tracking-[0.14em]"
            data-dialogue-scene-location
            title={scenePlaceName}
          >
            {scenePlaceName.toUpperCase()}
          </p>
        ) : null}
        {presentationMode === "comms" ? (
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
        {resolvedSpeaker && beat.kind === "npc" ? (
          <PortraitCueFrame sceneCues={sceneCues}>
            <Image
              key={`${beat.speakerNpcId}:${portraitGeneration}`}
              src={resolvedSpeaker.expressionAsset}
              alt={`${resolvedSpeaker.npc.displayName}, ${beat.expressionId} expression`}
              width={400}
              height={500}
              sizes="min(60vw, 24rem)"
              className="rs-dialogue-scene__npc absolute inset-x-1/2 bottom-0 z-20 h-[92%] w-auto -translate-x-1/2 object-contain"
              data-portrait-transition="fade-in"
              // Issue #117: the speaking NPC is the subject of the frame, but it
              // was the only lazy image in a scene whose background already had
              // priority — measured starting ~470 ms after that background on the
              // deployed site at 390 px DPR 3. One portrait renders per beat.
              priority
            />
          </PortraitCueFrame>
        ) : null}
        {resolvedItem && beat.kind === "item" ? (
          <span
            // Keyed on position, not item identity: two consecutive reward
            // beats for the same item (e.g. Refined Ferrite shown, then Power
            // Cell, then — hypothetically — Refined Ferrite again) must each
            // still read as a fresh reveal rather than reusing the outgoing
            // beat's DOM node and silently skipping its fade-in.
            key={`item:${beatIndex}`}
            aria-hidden="true"
            className="absolute bottom-[6%] left-1/2 z-20 flex h-[76%] max-w-[82%] -translate-x-1/2 items-center justify-center"
            data-dialogue-item-artwork
            data-portrait-transition="fade-in"
          >
            {resolvedItem.presentation.artworkSrc ? (
              <Image
                src={resolvedItem.presentation.artworkSrc}
                alt=""
                width={480}
                height={480}
                sizes="(max-width: 640px) 70vw, 24rem"
                className="h-full w-auto max-w-full object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.65)]"
                priority
              />
            ) : (
              <span className="rs-map-plate px-6 py-4 font-display text-4xl uppercase tracking-[0.14em]">
                {resolvedItem.presentation.textFallback}
              </span>
            )}
          </span>
        ) : null}
        {resolvedSkillXp && beat.kind === "skill_xp" ? (
          <div
            key={`${beat.skillId}:${portraitGeneration}`}
            className="absolute bottom-[10%] left-1/2 z-20 w-44 max-w-[70%] -translate-x-1/2"
            data-dialogue-skill-xp-tile
            data-portrait-transition="fade-in"
          >
            <SkillXpTile
              amount={beat.amount}
              skillId={resolvedSkillXp.skillId}
              skillName={resolvedSkillXp.presentation.displayName}
            />
          </div>
        ) : null}
        {beat.kind === "credits_receipt" ? (
          <div
            key={`credits:${beatIndex}:${portraitGeneration}`}
            className="absolute bottom-[10%] left-1/2 z-20 w-44 max-w-[70%] -translate-x-1/2"
            data-credits-amount={beat.amount}
            data-dialogue-credits-tile
            data-portrait-transition="fade-in"
          >
            <VisualTile
              accessibleLabel={`${beat.amount} Credits received`}
              artworkSrc={CREDITS_CHIP_SRC}
              badge={`+${beat.amount}`}
              fallbackText="CR"
              name="Credits"
            />
          </div>
        ) : null}
      </div>
      <div className="border-t border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-4 sm:p-5">
        <div>
          <p
            className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]"
            data-dialogue-speaker-name
          >
            {resolvedItem && beat.kind === "item"
              ? "Item"
              : resolvedSkillXp && beat.kind === "skill_xp"
                ? "Skill XP"
                : beat.kind === "credits_receipt"
                  ? "Credits"
                  : (resolvedSpeaker?.npc.displayName ?? "")}
          </p>
          <p className="mt-1 text-sm text-[color:var(--rs-text-muted)]" data-dialogue-speaker-role>
            {resolvedItem && beat.kind === "item" ? (
              `${resolvedItem.presentation.displayName}${resolvedItem.quantity > 1 ? ` ×${resolvedItem.quantity}` : ""}`
            ) : resolvedSkillXp && beat.kind === "skill_xp" ? (
              <>
                {resolvedSkillXp.presentation.displayName}{" "}
                <XpAmount
                  amount={resolvedSkillXp.amount}
                  prefix="+"
                  skillId={resolvedSkillXp.skillId}
                />
              </>
            ) : beat.kind === "credits_receipt" ? (
              <CreditsAmount amount={beat.amount} prefix="+" />
            ) : (
              (resolvedSpeaker?.npc.role ?? "")
            )}
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
          {beat.kind === "credits_receipt" ? (
            <span className="sr-only">{beat.amount} Credits received</span>
          ) : null}
          {resolvedItem && beat.kind === "item" ? (
            <span className="sr-only">
              {resolvedItem.presentation.accessibleDescription}
              {resolvedItem.quantity > 1 ? `, quantity ${resolvedItem.quantity}` : ""}
            </span>
          ) : null}
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

/**
 * The frame-relative layer a portrait cue animates (#441). It fills the frame, so a
 * sideways slide is a percent of the frame's width and the portrait's bottom edge
 * stays on the frame's: the approved portraits are cropped at the feet, and the
 * frame's own `overflow-hidden` keeps clipping them whatever the cue does. With no
 * cues it is not rendered at all and the portrait is exactly as it always was.
 */
function PortraitCueFrame({
  sceneCues,
  children,
}: {
  sceneCues: { frameRef: RefObject<HTMLDivElement | null>; state: SceneCueState } | undefined;
  children: ReactNode;
}) {
  if (!sceneCues) return <>{children}</>;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      data-scene-cue-target="portrait"
      style={sceneCueLayerStyle("portrait", sceneCues.state)}
    >
      {children}
    </div>
  );
}
