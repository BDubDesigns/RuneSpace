import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { ActionButton } from "./ActionButton";
import {
  MissionGuidanceHalo,
  missionGuidanceClassName,
  type MissionGuidanceKind,
} from "./MissionGuidanceHalo";

type MissionActionButtonProps = ComponentPropsWithoutRef<typeof ActionButton> & {
  /**
   * The one resolved guidance value for this control. Callers resolve
   * precedence (active green wins over available blue) before passing it.
   */
  guidance?: MissionGuidanceKind;
  /** Layout classes for the control's outer box (e.g. `w-full`, margins); the button fills it. */
  haloClassName?: string;
};

/**
 * An `ActionButton` that can carry Mission guidance with a visible exterior
 * halo. The button keeps the shared `.rs-mission-*` treatment and
 * `data-mission-guidance`; `MissionGuidanceHalo` paints the glow the beveled
 * button would otherwise clip. Non-beveled controls (e.g. the conversation
 * hub's Mission entries) apply the `.rs-mission-*` classes directly.
 *
 * While guided, the button always sits on the neutral `secondary` surface,
 * whatever `intent` the caller passes: the Mission colour lives on its text,
 * edge ring, and exterior halo, never its interior (a tinted or translucent
 * fill lets the halo wash through and blurs the control). Unguided, the
 * caller's `intent` applies as usual.
 */
export const MissionActionButton = forwardRef<HTMLButtonElement, MissionActionButtonProps>(
  function MissionActionButton(
    { guidance, haloClassName = "", className = "", intent, ...props },
    ref,
  ) {
    return (
      <MissionGuidanceHalo guidance={guidance} className={haloClassName}>
        <ActionButton
          {...props}
          intent={guidance ? "secondary" : intent}
          ref={ref}
          className={`grow ${missionGuidanceClassName(guidance)} ${className}`}
          data-mission-guidance={guidance}
        />
      </MissionGuidanceHalo>
    );
  },
);
