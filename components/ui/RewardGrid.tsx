import type { ReactNode } from "react";

/**
 * A wrapping grid of reward cards (#308). The columns that fit at the minimum
 * card width (`--rs-reward-card-min-width`) share the row's width equally, and
 * the rest wrap left to right. The tracks stay even when empty, so an
 * incomplete last row keeps one column's width and stays left-aligned — never
 * stretched — with no placeholder cells. Two across, three across, 2 + 1,
 * 2 + 2, 3 + 1 or four across all fall out of however many cards the caller maps
 * over and however wide the surface is, with no case of their own. Callers pass
 * only the rewards that actually exist.
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
