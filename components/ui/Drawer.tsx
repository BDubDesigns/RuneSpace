"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { ActionButton } from "./ActionButton";
import { SectionHeader } from "./SectionHeader";

/** Shared modal overlay used by Inventory and Equipment. */
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
  const backdrop = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const closing = useRef(false);

  function close() {
    closing.current = true;
    onClose();
    triggerRef.current?.focus();
  }

  // Move focus into the modal on open.
  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  // Keyboard: Escape dismisses, Tab cycles within the modal.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, triggerRef]);

  // Focus containment: if focus ever escapes the panel (e.g. after a button
  // becomes disabled), redirect it back to the close button.
  // Does not apply while the modal is intentionally closing.
  useEffect(() => {
    function onFocusIn(event: FocusEvent) {
      if (closing.current) return;
      if (panel.current && event.target instanceof Node && !panel.current.contains(event.target)) {
        closeButton.current?.focus();
      }
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  // Lock document scroll while open; restore on close/unmount.
  // Uses position:fixed + scrollY save/restore for iOS Safari compatibility.
  useEffect(() => {
    const scrollY = window.scrollY;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalTop = document.body.style.top;
    const originalWidth = document.body.style.width;
    const originalPaddingRight = document.body.style.paddingRight;

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.position = originalPosition;
      document.body.style.top = originalTop;
      document.body.style.width = originalWidth;
      document.body.style.paddingRight = originalPaddingRight;
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Backdrop click dismisses.  Clicking inside the panel does not.
  function onBackdropClick(event: React.MouseEvent) {
    if (event.target === backdrop.current) {
      close();
    }
  }

  return (
    <div
      ref={backdrop}
      className="rs-overlay-backdrop bg-[color:var(--rs-surface-page)]/70 fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
      onClick={onBackdropClick}
      role="presentation"
    >
      <section
        aria-label={label}
        aria-modal="true"
        className="rs-overlay-panel max-h-[min(78dvh,42rem)] w-full max-w-xl overflow-y-auto border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] [box-shadow:var(--rs-shadow-panel),0_0_28px_rgb(75_216_245_/_0.28)] sm:max-h-[calc(100dvh-2rem)] sm:w-[min(34rem,calc(100vw-2rem))]"
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
