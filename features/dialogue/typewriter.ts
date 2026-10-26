"use client";

import { useEffect, useMemo, useState } from "react";

/** One character every 20 ms: the dialogue typewriter's pace, shared by every surface that types. */
export const CHARACTER_REVEAL_MS = 20;

/**
 * The viewer's reduced-motion preference, followed live. It starts false so the
 * server markup and the first client render agree, then reads the real value.
 */
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

/**
 * The dialogue-style typewriter for one line of text (#404): the same 20 ms per
 * character the NPC conversation player uses, as a hook for any surface that
 * wants it.
 *
 * Text that changes after mount types from its first character, automatically,
 * with no tap. `initiallyComplete` shows the first text in full at once, which a
 * surface uses when the viewer is arriving late (a reload, a resumed journey)
 * rather than watching the line begin. Reduced motion shows every line in full.
 * `complete` is what hides the cursor.
 */
export function useTypewriter(
  text: string,
  options: { initiallyComplete?: boolean } = {},
): { visibleText: string; complete: boolean } {
  const reducedMotion = usePrefersReducedMotion();
  const characters = useMemo(() => Array.from(text), [text]);
  const [presentedText, setPresentedText] = useState(text);
  const [revealed, setRevealed] = useState(options.initiallyComplete ? characters.length : 0);

  // New text starts from its first character in the same render that presents
  // it, so one commit never shows the old line's length against the new line.
  if (presentedText !== text) {
    setPresentedText(text);
    setRevealed(0);
  }

  const complete = reducedMotion || revealed >= characters.length;
  useEffect(() => {
    if (complete) return;
    const timer = window.setTimeout(
      () => setRevealed((current) => Math.min(characters.length, current + 1)),
      CHARACTER_REVEAL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [complete, characters.length, revealed]);

  return {
    visibleText: complete ? text : characters.slice(0, revealed).join(""),
    complete,
  };
}
