"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PublicSiteNavItem } from "./PublicSiteShell";

const linkClass =
  "rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center text-sm font-semibold text-[color:var(--rs-text-secondary)] underline-offset-4 hover:text-[color:var(--rs-text-primary)] hover:underline";

export function PublicNavigation({ items }: { items: readonly PublicSiteNavItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);
  return (
    <nav aria-label="Public" className="min-w-0 flex-1">
      <ul className="hidden items-center gap-3 min-[360px]:flex sm:gap-5">
        {items.map((item) => (
          <li key={item.href}>
            <Link className={linkClass} href={item.href}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="relative min-[360px]:hidden" ref={root}>
        <button
          aria-controls="public-menu"
          aria-expanded={open}
          className={linkClass}
          onClick={() => setOpen(!open)}
          ref={button}
          type="button"
        >
          Menu {open ? "▴" : "▾"}
        </button>
        {open ? (
          <ul
            className="absolute left-0 z-50 min-w-40 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-navigation)] p-3 shadow-[var(--rs-shadow-panel)]"
            id="public-menu"
          >
            {items.map((item) => (
              <li key={item.href}>
                <Link className={linkClass} href={item.href} onClick={() => setOpen(false)}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </nav>
  );
}
