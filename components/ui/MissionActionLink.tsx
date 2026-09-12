import type { ComponentProps } from "react";
import { ActionLink } from "./ActionLink";
import {
  MissionGuidanceHalo,
  missionGuidanceClassName,
  type MissionGuidanceKind,
} from "./MissionGuidanceHalo";

type MissionActionLinkProps = ComponentProps<typeof ActionLink> & {
  /** The one resolved guidance value for this link. */
  guidance?: MissionGuidanceKind;
  /** Layout classes for the link's outer box (e.g. `w-full`, margins); the link fills it. */
  haloClassName?: string;
};

/**
 * An `ActionLink` that can carry Mission guidance with a visible exterior halo.
 * `ActionLink` is beveled like `ActionButton`, so it shares the same
 * `MissionGuidanceHalo` rather than a clipped one-off style.
 */
export function MissionActionLink({
  guidance,
  haloClassName = "",
  className = "",
  ...props
}: MissionActionLinkProps) {
  return (
    <MissionGuidanceHalo guidance={guidance} className={haloClassName}>
      <ActionLink
        {...props}
        className={`grow ${missionGuidanceClassName(guidance)} ${className}`}
        data-mission-guidance={guidance}
      />
    </MissionGuidanceHalo>
  );
}
