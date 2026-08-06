"use client";

import { useEffect, useState } from "react";

/**
 * Small transient status confirmation (issue #65 save completion).
 *
 * Renders a compact, positioned confirmation on the surface that triggered
 * the action — never inside a closing overlay — as a polite live region that
 * does not steal focus, is not a modal, and dismisses itself after a short
 * reasonable duration. Mounting/unmounting is motion-free, so
 * `prefers-reduced-motion` needs no special handling.
 */
export function TransientStatus({
  message,
  duration = 2600,
}: {
  message: string;
  /** How long the confirmation stays visible before dismissing itself. */
  duration?: number;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timer);
  }, [duration]);

  if (!visible) return null;

  return (
    <p
      className="fixed inset-x-0 bottom-4 z-[60] mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-2 border border-[color:var(--rs-accent-success)] bg-[color:var(--rs-surface-raised)] px-3 py-2 text-sm font-semibold text-[color:var(--rs-accent-success)] [box-shadow:var(--rs-shadow-panel)]"
      data-transient-status
      role="status"
    >
      <svg
        aria-hidden="true"
        className="h-4 w-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
        viewBox="0 0 24 24"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      {message}
    </p>
  );
}
