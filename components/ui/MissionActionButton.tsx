import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { ActionButton } from "./ActionButton";

/** The two Mission guidance meanings a control can carry: blue discovery or green progression. */
export type MissionGuidanceKind = "available" | "active";

type MissionActionButtonProps = ComponentPropsWithoutRef<typeof ActionButton> & {
  /**
   * The one resolved guidance value for this control. Callers resolve
   * precedence (active green wins over available blue) before passing it.
   */
  guidance?: MissionGuidanceKind;
  /** Layout classes for the control's outer box (e.g. `w-full`, margins); the button fills it. */
  haloClassName?: string;
};

const BUTTON_CLASS: Record<MissionGuidanceKind, string> = {
  available: "rs-mission-available",
  active: "rs-mission-guidance",
};

const HALO_TONE: Record<MissionGuidanceKind, string> = {
  available: "mission-available",
  active: "mission-active",
};

/**
 * An `ActionButton` that can carry Mission guidance with a visible exterior
 * halo.
 *
 * `ActionButton` is always beveled, and `.rs-bevel`'s clip-path clips anything
 * painted outside its polygon — so a guided button can only show its color and
 * inset ring, never its own glow. This component owns that workaround: the
 * button keeps the shared `.rs-mission-*` color treatment and
 * `data-mission-guidance`, while an unclipped `.rs-control-halo` wrapper paints
 * the exterior halo from the same Mission tokens (`app/globals.css`).
 *
 * The wrapper renders even without guidance so the button is never remounted
 * when guidance appears or clears; unguided it is layout- and paint-neutral.
 * Non-beveled controls (e.g. the conversation hub's Mission entries) apply the
 * `.rs-mission-*` classes directly and need none of this.
 */
export const MissionActionButton = forwardRef<HTMLButtonElement, MissionActionButtonProps>(
  function MissionActionButton({ guidance, haloClassName = "", className = "", ...props }, ref) {
    return (
      <span
        className={`rs-control-halo ${haloClassName}`}
        data-halo={guidance ? HALO_TONE[guidance] : undefined}
      >
        <ActionButton
          {...props}
          ref={ref}
          className={`grow ${guidance ? BUTTON_CLASS[guidance] : ""} ${className}`}
          data-mission-guidance={guidance}
        />
      </span>
    );
  },
);
