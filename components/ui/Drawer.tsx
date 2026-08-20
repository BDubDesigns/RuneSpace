"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ActionButton } from "./ActionButton";
import { SectionHeader } from "./SectionHeader";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Safety net for the exit fade. The *visible* timing lives in CSS
// (--rs-overlay-dur-box); the unmount normally fires on the panel's
// animationend. This timeout only guarantees we still unmount if that event
// never fires (element hidden, animation disabled, etc.). It must exceed the
// longest exit duration (200ms) plus margin, and is never the source of truth
// for what the player sees.
const EXIT_FALLBACK_MS = 400;

/**
 * Shared modal overlay used by Inventory, Equipment, and the character
 * portrait chooser.
 *
 * The modal renders through a portal to `document.body` so it can never be
 * trapped inside an ancestor that establishes a containing block or stacking
 * context (for example the `clip-path` bevel on `components/ui/Panel`): a
 * `position: fixed` dialog inside such an ancestor would be positioned and
 * clipped relative to that ancestor, letting the page behind intercept
 * pointer events. Portal rendering keeps the modal genuinely viewport-fixed
 * and above everything, wherever the triggering surface is mounted.
 *
 * The `size` variant is narrow and explicit: `"wide"` exists only for the
 * portrait chooser's desktop master-detail layout; every other surface keeps
 * the default width.
 */
export function Drawer({
  children,
  label,
  title,
  eyebrow,
  onClose,
  triggerRef,
  size = "default",
  dismissible = true,
  initialFocusRef,
}: {
  children: ReactNode;
  label: string;
  title: string;
  eyebrow: string;
  onClose?: () => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  size?: "default" | "wide";
  /** Some committed-result surfaces must be acknowledged before dismissal. */
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const closingRef = useRef(false); // re-entrancy guard for close()
  const finishedRef = useRef(false); // true once we return focus + unmount
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exiting, setExiting] = useState(false);

  const focusFirstAvailable = useCallback(() => {
    const panelElement = panel.current;
    if (!panelElement) return;

    const preferred = initialFocusRef?.current;
    if (preferred && panelElement.contains(preferred) && !preferred.hasAttribute("disabled")) {
      preferred.focus();
      return;
    }

    const fallback = panelElement.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (fallback ?? panelElement).focus();
  }, [initialFocusRef]);

  // The single unmount path. Idempotent: animationend and the fallback timer
  // both call this, so the guard prevents a double onClose()/focus jump.
  function finishClose() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (exitTimer.current) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    // Focus returns at the END of the fade, just before the dialog unmounts.
    triggerRef?.current?.focus();
    onClose?.();
  }

  // Begin closing. Either unmounts instantly (reduced motion) or starts the
  // exit fade and defers the unmount until the animation finishes.
  function close() {
    if (!dismissible) return;
    if (closingRef.current) return; // ignore repeated Escape/backdrop/Close
    closingRef.current = true;

    if (typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      finishClose();
      return;
    }

    // Keep the keyboard trap valid for the whole fade: if focus has somehow
    // left the panel, park it on the Close button before we start fading so
    // Tab can never slip behind the still-visible backdrop.
    const active = document.activeElement;
    if (!(active instanceof Node && panel.current?.contains(active))) {
      if (dismissible) closeButton.current?.focus();
      else focusFirstAvailable();
    }
    setExiting(true);
  }

  // Move focus into the modal on open.
  useEffect(() => {
    focusFirstAvailable();
  }, [focusFirstAvailable]);

  // Keyboard: Escape dismisses, Tab cycles within the modal.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!dismissible) return;
        close();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
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
  }, [dismissible, focusFirstAvailable, onClose, triggerRef]);

  // Focus containment while open AND during the fade-out. finishedRef lets the
  // final focus-return-to-trigger pass through without being trapped back into
  // the (about-to-unmount) panel.
  useEffect(() => {
    function onFocusIn(event: FocusEvent) {
      if (finishedRef.current) return;
      if (panel.current && event.target instanceof Node && !panel.current.contains(event.target)) {
        focusFirstAvailable();
      }
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [focusFirstAvailable]);

  // Lock document scroll while open; restore on close/unmount.
  // Uses position:fixed + scrollY save/restore for iOS Safari compatibility.
  // Cleanup runs on unmount, so the page stays locked through the whole fade
  // (no background jump) and restores the instant the dialog is removed.
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

  // Deferred unmount: once the exit fade starts, unmount on the panel's exit
  // animationend, with a timeout safety net in case the event never fires.
  useEffect(() => {
    if (!exiting) return;
    exitTimer.current = setTimeout(finishClose, EXIT_FALLBACK_MS);
    return () => {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exiting]);

  // Unmount when the panel's own exit animation ends. Guard on target + name so
  // bubbled animationend from descendants (and the enter animation) are ignored.
  function onPanelAnimationEnd(event: React.AnimationEvent<HTMLElement>) {
    if (event.target !== panel.current) return;
    if (event.animationName !== "rs-overlay-panel-exit") return;
    finishClose();
  }

  // Backdrop click dismisses.  Clicking inside the panel does not.
  function onBackdropClick(event: React.MouseEvent) {
    if (dismissible && event.target === backdrop.current) {
      close();
    }
  }

  const backdropAnim = exiting ? "rs-overlay-backdrop-exit" : "rs-overlay-backdrop";
  const panelAnim = exiting ? "rs-overlay-panel-exit" : "rs-overlay-panel";

  return createPortal(
    <div
      ref={backdrop}
      className={`${backdropAnim} fixed inset-0 z-50 !mt-0 flex items-center justify-center bg-[color:var(--rs-overlay-scrim)] p-3 sm:p-4`}
      onClick={onBackdropClick}
      role="presentation"
    >
      <section
        aria-label={label}
        aria-modal="true"
        className={`${panelAnim} max-h-[min(78dvh,42rem)] w-full overflow-y-auto border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] [box-shadow:var(--rs-shadow-panel),0_0_28px_rgb(75_216_245_/_0.28)] sm:max-h-[calc(100dvh-2rem)] ${
          size === "wide"
            ? "sm:w-[min(56rem,calc(100vw-2rem))] sm:max-w-4xl"
            : "max-w-xl sm:w-[min(34rem,calc(100vw-2rem))]"
        }`}
        onAnimationEnd={onPanelAnimationEnd}
        ref={panel}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-3">
          <SectionHeader eyebrow={eyebrow}>{title}</SectionHeader>
          {dismissible ? (
            <ActionButton
              ref={closeButton}
              aria-label={`Close ${label.toLowerCase()}`}
              className="shrink-0 px-3"
              intent="secondary"
              onClick={close}
            >
              Close
            </ActionButton>
          ) : null}
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
