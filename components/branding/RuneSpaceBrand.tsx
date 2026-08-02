import Image from "next/image";

const LOCKUP_WIDTH = 1455;
const LOCKUP_HEIGHT = 376;

/**
 * Approved production RuneSpace horizontal brand lockup (Issue #52).
 *
 * Single reusable rendering of the reviewed lockup asset; never recreate the
 * logo in CSS or substitute placeholder art. The approved source lives at
 * `public/branding/runespace-header-lockup.png` (see docs/design-system.md).
 *
 * Intrinsic dimensions are fixed so the header does not jump while the image
 * loads; consumers scale it with a height class (e.g. `h-7 w-auto` in the
 * header, matching the 28px title line height it replaces, or a larger height
 * on the landing page). The `alt` text provides the accessible brand name.
 */
export function RuneSpaceBrand({
  className = "block h-7 w-auto",
  sizes = "128px",
  priority = true,
}: {
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <Image
      alt="RuneSpace"
      className={className}
      height={LOCKUP_HEIGHT}
      priority={priority}
      sizes={sizes}
      src="/branding/runespace-header-lockup.png"
      width={LOCKUP_WIDTH}
    />
  );
}
