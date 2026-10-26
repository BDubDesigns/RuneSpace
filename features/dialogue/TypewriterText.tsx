"use client";

import { useTypewriter } from "@/features/dialogue/typewriter";

/**
 * One line that types itself in the dialogue treatment (#404): the visible text
 * and the blinking `rs-dialogue-cursor` underscore are hidden from assistive
 * technology, and a polite live region carries the whole line once, never a
 * character at a time. The cursor goes away when the line is complete.
 */
export function TypewriterText({
  text,
  initiallyComplete,
  className,
  fullTextId,
}: {
  text: string;
  initiallyComplete?: boolean;
  className?: string;
  /** An id on the whole-line copy, so a dialog can name it with `aria-describedby`. */
  fullTextId?: string;
}) {
  const { visibleText, complete } = useTypewriter(text, { initiallyComplete });
  return (
    <p
      className={`rs-typewriter ${className ?? ""}`}
      data-typewriter-complete={complete ? "true" : "false"}
    >
      {/* The whole line, unseen, holds the box at its final height. */}
      <span aria-hidden="true" className="rs-typewriter__sizer">
        {text}
        <span className="ml-0.5">_</span>
      </span>
      <span aria-hidden="true" data-typewriter-visible>
        {visibleText}
        {complete ? null : <span className="rs-dialogue-cursor ml-0.5">_</span>}
      </span>
      <span
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        data-typewriter-full
        id={fullTextId}
      >
        {text}
      </span>
    </p>
  );
}
