"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { ActionButton } from "./ActionButton";
import { SectionHeader } from "./SectionHeader";

/** Modal drawer convention shared by persistent player-footer controls. */
export function Drawer({
  children,
  label,
  title,
  eyebrow,
  onClose,
  triggerRef,
}: {
  children: ReactNode;
  label: string;
  title: string;
  eyebrow: string;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  function close() {
    onClose();
    triggerRef.current?.focus();
  }
  useEffect(() => {
    closeButton.current?.focus();
  }, []);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, triggerRef]);
  return (
    <div
      className="bg-[color:var(--rs-surface-page)]/90 fixed inset-0 z-50 flex items-end p-3 sm:items-center sm:justify-end sm:p-4"
      role="presentation"
    >
      <section
        aria-label={label}
        aria-modal="true"
        className="max-h-[min(78dvh,42rem)] w-full max-w-xl overflow-y-auto border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] [box-shadow:var(--rs-shadow-panel)] sm:max-h-[calc(100dvh-2rem)] sm:w-[min(34rem,calc(100vw-2rem))]"
        ref={panel}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <SectionHeader eyebrow={eyebrow}>{title}</SectionHeader>
          <ActionButton
            ref={closeButton}
            aria-label={`Close ${label.toLowerCase()}`}
            className="shrink-0 px-3"
            intent="secondary"
            onClick={close}
          >
            Close
          </ActionButton>
        </div>
        {children}
      </section>
    </div>
  );
}
