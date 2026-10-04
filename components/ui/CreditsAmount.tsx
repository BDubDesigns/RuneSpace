import type { HTMLAttributes, ReactNode } from "react";

/** The owner-supplied simplified Credits icon; the single source for every inline amount. */
export const CREDITS_ICON_SRC = "/currency/credits-icon.svg";

/**
 * The approved battered Credits chip, for confirmed Mission payout reveals only.
 * A transparent derivative of the owner-supplied master (`assets/currency/`).
 * Credits are ordinary currency, never an inventory item.
 */
export const CREDITS_CHIP_SRC = "/currency/credits-chip.webp";

/**
 * The approved inline Credits icon (#290). Purely decorative: the adjacent text
 * always states the amount, so it is hidden from assistive technology and
 * carries no alt text. It is sized from the surrounding text (`1em`, see
 * `.rs-credits-icon`), so it needs no size prop and stays correct in a heading,
 * a compact row, or a button.
 *
 * Use it directly only where a data hook must wrap just the number; otherwise
 * use `CreditsAmount`. Never put it in prose, chat, authored dialogue, or
 * server strings — those stay plain text.
 */
export function CreditsIcon({ className = "" }: { className?: string }) {
  return (
    // A static decorative SVG: next/image would add an optimizer round trip for
    // an unoptimizable vector.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      aria-hidden="true"
      className={`rs-credits-icon ${className}`}
      data-credits-icon
      draggable={false}
      src={CREDITS_ICON_SRC}
    />
  );
}

type CreditsAmountProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  amount: number;
  /**
   * The visible unit word after the number: "Credits" by default, "Cr" for the
   * Work Orders payout badge, or `null` for the number alone. The words stay
   * visible text so the amount reads identically with images unavailable.
   */
  unit?: "Credits" | "Cr" | null;
  /** Text immediately before the number, e.g. "+". */
  prefix?: string;
  /**
   * Pre-formatted amount text (e.g. `formatCredits`' grouped, singular-aware
   * string) when a surface already owns its number formatting. It replaces the
   * default `${amount} ${unit}` text; the icon is unchanged.
   */
  children?: ReactNode;
};

/**
 * A structured Credit amount: the inline icon followed by the visible number
 * and unit. Authority is unchanged — this only presents a figure the caller
 * already has. Extra props (notably `data-*` hooks) land on the wrapper, whose
 * text content is exactly the amount text because the icon contributes none.
 */
export function CreditsAmount({
  amount,
  unit = "Credits",
  prefix = "",
  children,
  className = "",
  ...rest
}: CreditsAmountProps) {
  return (
    <span {...rest} className={`rs-credits-amount ${className}`}>
      <CreditsIcon />
      <span>{children ?? `${prefix}${amount}${unit ? ` ${unit}` : ""}`}</span>
    </span>
  );
}
