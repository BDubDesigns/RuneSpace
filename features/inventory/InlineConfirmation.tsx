import type { ReactNode, RefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";

/**
 * The irreversible-action confirmation shown inside an Item Details action
 * section, in place of the action that opened it (#395). Presentational only:
 * the owning panel keeps the confirmation state and the commands.
 */
export function InlineConfirmation({
  busy,
  cancelRef,
  children,
  confirmLabel,
  onCancel,
  onConfirm,
  ...dataAttributes
}: {
  busy: boolean;
  cancelRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  "data-break-apart-confirmation"?: boolean;
  "data-drop-confirmation"?: boolean;
  "data-research-abandon-confirmation"?: boolean;
}) {
  return (
    <div
      className="mt-2 border border-[color:var(--rs-accent-danger)] bg-[color:var(--rs-surface-panel)] p-3"
      role="alert"
      {...dataAttributes}
    >
      <div className="flex items-start gap-2">
        <svg
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--rs-accent-danger)]"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
        <div className="min-w-0 text-sm text-[color:var(--rs-text-secondary)]">
          <span className="sr-only">Warning: </span>
          {children}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ActionButton disabled={busy} intent="secondary" onClick={onCancel} ref={cancelRef}>
          Cancel
        </ActionButton>
        <ActionButton disabled={busy} intent="danger" loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </ActionButton>
      </div>
    </div>
  );
}
