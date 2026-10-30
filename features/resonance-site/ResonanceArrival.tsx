"use client";

import { useEffect, useId, useRef, useState, useTransition, type MutableRefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { DialogueScene } from "@/features/dialogue/DialogueScene";
import { usePlay } from "@/features/play/PlayContext";
import { useTeleportCinematic } from "@/features/rune-teleport/TeleportCinematic";
import {
  usePrefersReducedMotion,
  useSceneCuePlayer,
} from "@/features/scene-cues/use-scene-cue-player";
import { CONVERSATION_BACKGROUND_IDS, EXPRESSION_IDS, NPC_IDS } from "@/game/config/foundations";
import { PERSONAL_RESONANCE_RIG } from "@/game/content/resonance-rig";
import { RESONANCE_ARRIVAL_CUES } from "@/game/content/scene-cues";
import { SCENE_CUE_REST, sceneCueInitialState } from "@/game/domain/scene-cues";
import { acknowledgeResonanceArrivalAction } from "@/server/actions";
import { RESONANCE_ARRIVAL_COPY } from "./resonance-site-copy";

/**
 * The Wise Old Enby arrives at the character's finished Resonance Rig (#441): a
 * short, skippable 15:8 scene over the Crash Site — the Core lights, a rift opens
 * beside the Rig, the Enby's existing portrait fades in, the rift closes, and a
 * one-time caption says so. It plays through the shared `DialogueScene` and the
 * reusable scene-cue layer, so it is the same stage, the same Rig and the same
 * bottom-anchored, foot-clipped portrait every Enby conversation uses.
 *
 * It is a presentation of something that has already happened. The Rig's last weld
 * moved the Enby (server-derived) before this exists; this appears whenever the
 * server's projection says the player has not yet seen it, so a reload, a weld that
 * finished offline or another device shows it too, and an acknowledged one is
 * never owed again. It never starts a conversation and never completes anything.
 *
 * CONTINUE, SKIP, Escape and tapping outside are one path: acknowledge, then the
 * ordinary Resonance Site. If that cannot be confirmed the scene stays with the
 * reason, so a lost response never swallows the arrival.
 */
export function ResonanceArrival() {
  const { acceptState, enqueueForeground, releaseCommand, state } = usePlay();
  const cinematic = useTeleportCinematic();
  const [mounted, setMounted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<string>();
  const [, startTransition] = useTransition();
  const closeHandle: MutableRefObject<(() => void) | null> = useRef(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const cues = useSceneCuePlayer(frameRef, reducedMotion);
  const descriptionId = useId();
  const owed = state.resonanceArrival;
  // The scene is the Rig's own place: it presents where the Rig is, and waits
  // (still owed) while the player is elsewhere or a teleport is still revealing.
  const present =
    mounted &&
    owed !== undefined &&
    state.location.currentLocationId === PERSONAL_RESONANCE_RIG.locationId &&
    !cinematic.active &&
    !state.runeTeleport.arrival &&
    !state.research.arrival;

  useEffect(() => setMounted(true), []);
  const { play, cancel } = cues;
  const arrivalKey = owed?.completedAt;
  useEffect(() => {
    if (!present) return;
    play(RESONANCE_ARRIVAL_CUES);
    return cancel;
    // The show starts when the arrival appears, and once per owed arrival.
  }, [present, arrivalKey, attempt, play, cancel]);

  if (!present) return null;

  function acknowledge() {
    enqueueForeground(() => {
      startTransition(async () => {
        try {
          const result = await acknowledgeResonanceArrivalAction({
            characterId: state.characterId,
          });
          if (result.error || !result.state) {
            setMessage(result.error ?? RESONANCE_ARRIVAL_COPY.unconfirmed);
            setAttempt((current) => current + 1);
            return;
          }
          setMessage(undefined);
          acceptState(result.state);
        } catch {
          setMessage(RESONANCE_ARRIVAL_COPY.unconfirmed);
          setAttempt((current) => current + 1);
        } finally {
          releaseCommand();
        }
      });
    });
  }

  const finished = cues.phase === "done";
  const caption = RESONANCE_ARRIVAL_CUES.caption ?? "";
  return (
    <Drawer
      closeHandleRef={closeHandle}
      describedById={descriptionId}
      eyebrow={RESONANCE_ARRIVAL_COPY.eyebrow}
      key={`${owed?.completedAt}:${attempt}`}
      label={RESONANCE_ARRIVAL_COPY.label}
      onClose={acknowledge}
      size="wide"
      title={RESONANCE_ARRIVAL_COPY.title}
    >
      <div data-resonance-arrival={owed?.completedAt} data-resonance-arrival-phase={cues.phase}>
        <DialogueScene
          actionMessage={message}
          beat={{
            kind: "npc",
            speakerNpcId: NPC_IDS.wiseOldEnby,
            expressionId: EXPRESSION_IDS.friendly,
            backgroundId: CONVERSATION_BACKGROUND_IDS.crashSiteResonanceSite,
            presentationMode: "local",
            text: caption,
          }}
          // The caption is one-time and arrives with the end of the show; until
          // then the screen-reader copy is still the whole line.
          fullText={caption}
          isComplete
          sceneCues={{
            frameRef,
            state: cues.state ?? sceneCueInitialState(RESONANCE_ARRIVAL_CUES) ?? SCENE_CUE_REST,
          }}
          visibleText={finished || reducedMotion ? caption : ""}
          controls={
            <div className="flex w-full justify-end gap-2" id={descriptionId}>
              {finished ? (
                <ActionButton
                  data-resonance-arrival-continue
                  intent="primary"
                  onClick={() => closeHandle.current?.()}
                >
                  {RESONANCE_ARRIVAL_COPY.continueLabel}
                </ActionButton>
              ) : (
                <ActionButton
                  data-resonance-arrival-skip
                  intent="secondary"
                  onClick={() => cues.skip()}
                >
                  {RESONANCE_ARRIVAL_COPY.skipLabel}
                </ActionButton>
              )}
            </div>
          }
        />
      </div>
    </Drawer>
  );
}
