import type { ReactNode } from "react";

/** The two Mission guidance meanings a control can carry: blue discovery or green progression. */
export type MissionGuidanceKind = "available" | "active";

const CONTROL_CLASS: Record<MissionGuidanceKind, string> = {
  available: "rs-mission-available",
  active: "rs-mission-guidance",
};

const HALO_TONE: Record<MissionGuidanceKind, string> = {
  available: "mission-available",
  active: "mission-active",
};

/** The shared color/inset treatment class for a guided control, or "" when unguided. */
export function missionGuidanceClassName(guidance?: MissionGuidanceKind): string {
  return guidance ? CONTROL_CLASS[guidance] : "";
}

/**
 * The unclipped outer box that paints a Mission-guided beveled control's
 * exterior halo.
 *
 * `.rs-bevel` controls (`ActionButton`, `ActionLink`) clip everything painted
 * outside their polygon, so they can never show their own glow. This wrapper
 * carries `.rs-control-halo` and the tone (`app/globals.css`), while the
 * control inside keeps the shared `.rs-mission-*` color treatment. It renders
 * even without guidance so the control is never remounted when guidance
 * appears or clears; unguided it is layout- and paint-neutral. Ancestors must
 * not clip it either — no `overflow: hidden` within the glow's reach.
 */
export function MissionGuidanceHalo({
  guidance,
  className = "",
  children,
}: {
  /** The one resolved guidance value; callers resolve active-over-available first. */
  guidance?: MissionGuidanceKind;
  /** Layout classes for the control's outer box (e.g. `w-full`, margins). */
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`rs-control-halo ${className}`}
      data-halo={guidance ? HALO_TONE[guidance] : undefined}
    >
      {children}
    </span>
  );
}
