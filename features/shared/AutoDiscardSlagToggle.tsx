"use client";

import type { ComponentProps } from "react";
import { ActionButton } from "@/components/ui/ActionButton";

/**
 * The character-wide Auto-discard Slag toggle (#256), shared by Practice
 * Welding and Refining.
 *
 * Presentational only: which value it shows and what a press does belong to the
 * caller, and the value is the server's shared character preference in both
 * places. It belongs to no one skill, so it latches in `primary`, like the
 * bounded-run selector's Max, rather than borrowing either activity's accent.
 * The label names one setting and `aria-pressed` says whether it is on.
 */
export function AutoDiscardSlagToggle({
  autoDiscardSlag,
  hint,
  onToggle,
  ...buttonProps
}: {
  autoDiscardSlag: boolean;
  /** When the setting takes effect, in the caller's own terms. */
  hint: string;
  onToggle: (next: boolean) => void;
} & Pick<ComponentProps<typeof ActionButton>, "disabled" | "loading"> &
  Record<`data-${string}`, boolean | string | undefined>) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ActionButton
        {...buttonProps}
        aria-pressed={autoDiscardSlag}
        intent={autoDiscardSlag ? "primary" : "secondary"}
        onClick={() => onToggle(!autoDiscardSlag)}
      >
        Auto-discard Slag: {autoDiscardSlag ? "On" : "Off"}
      </ActionButton>
      <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">{hint}</p>
    </div>
  );
}
