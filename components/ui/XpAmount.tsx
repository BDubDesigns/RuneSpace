import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import { skillAccentColor } from "./skill-accent";

/**
 * The approved shared skill-XP medallion (#304), for reward-tile moments only.
 * A transparent derivative of the owner-supplied master (`assets/xp/`); one
 * neutral image for every skill. XP is never an inventory item or currency.
 */
export const XP_MEDALLION_SRC = "/xp/xp-medallion.webp";

/**
 * The accent for a skill's XP, from the one canonical skill registry. A skill
 * with no approved accent (or no skill at all) resolves to `undefined`, and the
 * mark then renders in its neutral color.
 */
export function xpAccentColor(
  skillId: string | undefined,
  accentTone?: string,
): string | undefined {
  return skillAccentColor(
    accentTone ?? (skillId === undefined ? undefined : getSkillPresentation(skillId)?.accentTone),
  );
}

type XpMarkProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  /** Canonical skill ID; the outline and letters take that skill's accent. */
  skillId?: string;
  /**
   * The skill's accent tone, for a surface whose data carries the tone but not
   * the ID (character progression). Takes precedence over `skillId`.
   */
  accentTone?: string;
};

/**
 * The approved compact inline XP treatment (#304): the literal text `XP` in a
 * thin outlined lozenge keyed to the skill's accent. It is real text, sized
 * from the surrounding type (`.rs-xp-mark`), so it needs no size prop and
 * leaves the line height alone at `text-xs` through headings. Colour only
 * supplements the word.
 *
 * Use it for a structured XP readout, in place of the bare word `XP`. Never in
 * prose: authored dialogue, chat, server strings, `aria-label`s and admin or
 * public-site pages stay plain text.
 */
export function XpMark({ skillId, accentTone, className = "", style, ...rest }: XpMarkProps) {
  const accent = xpAccentColor(skillId, accentTone);
  return (
    <span
      {...rest}
      className={`rs-xp-mark ${className}`}
      data-xp-mark
      style={accent ? ({ "--rs-xp-accent": accent, ...style } as CSSProperties) : style}
    >
      XP
    </span>
  );
}

type XpAmountProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  amount: number;
  /** Canonical skill ID, for the accent. */
  skillId?: string;
  /** The skill's accent tone, when the surface has the tone but not the ID. */
  accentTone?: string;
  /** The skill's display name, shown between the number and `XP` when the surface needs it. */
  skillName?: string;
  /** Text immediately before the number, e.g. "+". */
  prefix?: string;
  /**
   * Pre-formatted amount text (e.g. a grouped number) when a surface already
   * owns its number formatting. It replaces the default `${prefix}${amount}`.
   */
  children?: ReactNode;
};

/**
 * A structured XP amount: the visible number, the skill name when given, then
 * the outlined `XP` mark. The wrapper's text content reads exactly
 * `+250 Mining XP`. Authority is unchanged — this only presents a figure the
 * caller already has. Extra props (notably `data-*` hooks) land on the wrapper.
 */
export function XpAmount({
  amount,
  skillId,
  accentTone,
  skillName,
  prefix = "",
  children,
  className = "",
  ...rest
}: XpAmountProps) {
  return (
    <span {...rest} className={`rs-xp-amount ${className}`}>
      {children ?? `${prefix}${amount}`}
      {skillName ? ` ${skillName}` : ""} <XpMark accentTone={accentTone} skillId={skillId} />
    </span>
  );
}
