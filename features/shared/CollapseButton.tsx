"use client";

/** Prominent −/+ disclosure button used by collapsible panels. */
export function CollapseButton({
  collapsed,
  onToggle,
  label,
}: {
  collapsed: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      aria-expanded={!collapsed}
      aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      className="rs-bevel rs-focus inline-flex min-h-[var(--rs-touch-target)] w-9 shrink-0 items-center justify-center border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] text-lg font-bold text-[color:var(--rs-text-primary)] transition duration-[var(--rs-duration-fast)] hover:border-[color:var(--rs-accent-secondary)]"
      onClick={onToggle}
      type="button"
    >
      <span aria-hidden="true">{collapsed ? "+" : "−"}</span>
    </button>
  );
}
