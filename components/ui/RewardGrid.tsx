import type { ReactNode } from "react";

/**
 * A wrapping grid of reward cards (#308). Every card keeps the same normal
 * width (`--rs-reward-card-width`); the grid fits as many equal columns as the
 * surface allows and wraps the rest left to right. Fixed-width columns are what
 * keep an incomplete last row left-aligned and its cards unstretched, with no
 * placeholder cells — so two, three, 2 + 1, 2 + 2, 3 + 1 or four across all
 * fall out of however many cards the caller maps over, with no case of their
 * own. Callers pass only the rewards that actually exist.
 */
export function RewardGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rs-reward-grid ${className}`} data-reward-grid="">
      {children}
    </div>
  );
}
