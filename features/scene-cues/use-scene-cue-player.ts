"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  sceneCueFinalState,
  sceneCueInitialState,
  sceneCueKeyframes,
  orderedSceneCues,
  sceneCueSequenceDuration,
  type SceneCueSequence,
  type SceneCueState,
  type SceneCueTarget,
} from "@/game/domain/scene-cues";

/** Whether the visitor asked for less motion. Re-read live, like the dialogue player does. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

export type SceneCuePhase = "idle" | "playing" | "done";

/**
 * Plays an authored scene-cue sequence over a composed scene (#441).
 *
 * Pure presentation: it reads the layers by `data-scene-cue-target` inside `rootRef`
 * and animates them with the Web Animations API, so there is no per-frame React
 * state and nothing it does can reach a game rule. It reports `state`, the layers'
 * current resting state, so the host can render the first frame already correct
 * (a portrait that fades in is invisible from the very first paint) and keep the
 * final one after the animations are cleaned up.
 *
 * - **Reduced motion** skips every animation and goes straight to the final state.
 * - **Skip** finishes every animation at once, reaching the same final state.
 * - **Interruption** (unmount, a new sequence) cancels the animations; it never
 *   completes the sequence, so a half-played show cannot report success.
 * - A fallback timer completes the sequence when the browser throttles animation
 *   timelines (a backgrounded tab), so the host is never left waiting.
 */
export function useSceneCuePlayer(rootRef: RefObject<HTMLElement | null>, reducedMotion: boolean) {
  const [phase, setPhase] = useState<SceneCuePhase>("idle");
  const [sequence, setSequence] = useState<SceneCueSequence>();
  const [state, setState] = useState<SceneCueState>();
  const animations = useRef<Animation[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const complete = useRef<(() => void) | undefined>(undefined);
  const generation = useRef(0);

  const cancel = useCallback(() => {
    generation.current += 1;
    window.clearTimeout(timer.current);
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    complete.current = undefined;
  }, []);

  useEffect(() => cancel, [cancel]);

  const finish = useCallback((next: SceneCueSequence, run: number) => {
    if (generation.current !== run) return;
    window.clearTimeout(timer.current);
    // Commit the final resting state to React first, so cancelling the animations
    // leaves the layers exactly where playing them would have.
    setState(sceneCueFinalState(next));
    setPhase("done");
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    const done = complete.current;
    complete.current = undefined;
    done?.();
  }, []);

  /** Begin a sequence. `onComplete` runs once, when it ends or is skipped. */
  const play = useCallback(
    (next: SceneCueSequence, onComplete?: () => void) => {
      cancel();
      const run = generation.current;
      complete.current = onComplete;
      setSequence(next);
      setState(sceneCueInitialState(next));
      if (reducedMotion) {
        // Straight to where the show ends, then on, after a beat so a caption can land.
        setPhase("playing");
        timer.current = window.setTimeout(() => finish(next, run), 0);
        return;
      }
      setPhase("playing");
      // Wait a frame so the host has rendered the initial state before animating it.
      requestAnimationFrame(() => {
        if (generation.current !== run) return;
        const root = rootRef.current;
        const started: Animation[] = [];
        // In start order, so a later cue on the same layer (a rift that opens, then
        // closes) always composites over an earlier one.
        for (const cue of orderedSceneCues(next)) {
          const element = root?.querySelector<HTMLElement>(
            `[data-scene-cue-target="${cue.target satisfies SceneCueTarget}"]`,
          );
          if (!element) continue;
          const { keyframes, easing } = sceneCueKeyframes(cue);
          started.push(
            element.animate(keyframes, {
              delay: cue.at,
              duration: cue.duration,
              easing,
              // Forwards only: before its cue starts a layer shows the resting style the
              // host already rendered, so a later cue's first keyframe (a rift's closing
              // frame is fully open) can never show through ahead of its time.
              fill: "forwards",
            }),
          );
        }
        animations.current = started;
        timer.current = window.setTimeout(
          () => finish(next, run),
          sceneCueSequenceDuration(next) + 150,
        );
        void Promise.all(
          started.map((animation) => animation.finished.catch(() => undefined)),
        ).then(() => finish(next, run));
      });
    },
    [cancel, finish, reducedMotion, rootRef],
  );

  /** Jump to the end now. Reaches the same state, and the same completion, as playing. */
  const skip = useCallback(() => {
    if (!sequence || phase !== "playing") return;
    finish(sequence, generation.current);
  }, [finish, phase, sequence]);

  return { phase, state, sequence, play, skip, cancel };
}
