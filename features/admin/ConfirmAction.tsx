"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";

/**
 * A confirm-before-commit operator action (Issue #113), shared by the
 * character controls and the issue #223 access controls.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  intent = "danger",
  title,
  prompt,
  disabled,
  fullWidth,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  /** Visual weight. Defer to `danger` for destructive, `secondary` for regular. */
  intent?: "danger" | "secondary";
  /** Optional confirmation question shown above the prompt in the armed state. */
  title?: string;
  /**
   * A concrete, operator-facing description of what WILL change on the target
   * (names the affected entity/value). Shown only in the armed state so the
   * operator confirms the actual consequence, not a generic prompt.
   */
  prompt?: string;
  disabled?: boolean;
  /**
   * Callers opt into a full-width button for genuinely section-level controls
   * (e.g. RESET ALL). Compact row actions (Unequip, Remove, Set, …) default to
   * sizing to their content so they never crush a row-mate.
   */
  fullWidth?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [arming, setArming] = useState(false);
  const [pending, setPending] = useState(false);
  if (!arming) {
    return (
      <ActionButton
        intent={intent}
        disabled={disabled}
        onClick={() => setArming(true)}
        className={fullWidth ? "w-full" : ""}
      >
        {label}
      </ActionButton>
    );
  }
  return (
    <div
      className={`rounded border bg-[color:var(--rs-surface)] p-2 ${
        intent === "danger"
          ? "border-[color:var(--rs-border-danger,var(--rs-border-structural))]"
          : "border-[color:var(--rs-border-structural)]"
      } ${fullWidth ? "w-full" : "w-full sm:w-auto"}`}
    >
      {title ? (
        <p className="mb-1 text-sm font-semibold text-[color:var(--rs-text-primary)]">{title}</p>
      ) : null}
      {prompt ? <p className="mb-2 text-xs text-[color:var(--rs-text-primary)]">{prompt}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          intent={intent}
          loading={pending}
          disabled={disabled}
          onClick={async () => {
            setPending(true);
            try {
              await onConfirm();
            } finally {
              setPending(false);
              setArming(false);
            }
          }}
        >
          {confirmLabel}
        </ActionButton>
        <ActionButton intent="secondary" onClick={() => setArming(false)}>
          Cancel
        </ActionButton>
      </div>
    </div>
  );
}
