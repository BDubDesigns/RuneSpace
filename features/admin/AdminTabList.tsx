"use client";

import { useRef, type KeyboardEvent } from "react";

/**
 * The inspector's section tabs (#333): an ARIA tab list with a roving tab stop,
 * arrow/Home/End navigation and automatic activation, in the tab style the
 * Inventory/Equipment surface already uses. The strip is its own horizontal
 * scroll container, so at phone width every tab stays reachable without
 * horizontal overflow on the page itself.
 */
export type AdminTabDefinition<Id extends string> = { id: Id; label: string };

export function adminTabId(id: string): string {
  return `admin-tab-${id}`;
}

export function adminTabPanelId(id: string): string {
  return `admin-tab-panel-${id}`;
}

export function AdminTabList<Id extends string>({
  tabs,
  selected,
  onSelect,
}: {
  tabs: readonly AdminTabDefinition<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onSelect(target.id);
    refs.current[target.id]?.focus();
  }

  return (
    <div
      aria-label="Character inspector sections"
      className="flex gap-1 overflow-x-auto border-b border-[color:var(--rs-border-structural)] pb-1"
      data-testid="admin-tabs"
      role="tablist"
    >
      {tabs.map((tab, index) => {
        const active = tab.id === selected;
        return (
          <button
            aria-controls={adminTabPanelId(tab.id)}
            aria-selected={active}
            className={`rs-focus min-h-[var(--rs-touch-target)] shrink-0 whitespace-nowrap border px-3 py-2 font-display text-xs uppercase tracking-[0.12em] outline-none ${
              active
                ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)] text-[color:var(--rs-accent-primary)]"
                : "border-[color:var(--rs-border-structural)] text-[color:var(--rs-text-secondary)]"
            }`}
            data-admin-tab={tab.id}
            id={adminTabId(tab.id)}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            ref={(element) => {
              refs.current[tab.id] = element;
            }}
            role="tab"
            tabIndex={active ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
