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
 * loads. The default treatment is the authenticated header sizing approved by
 * the product owner: about 44px tall on mobile and 48px from the `sm`
 * breakpoint. The lockup scales proportionally (auto height capped at those
 * heights) and is capped to 52% of the viewport and to its flex container, so
 * it shrinks responsively before wrapping or overflowing the single header
 * panel it shares with the Sign out control. The signed-out landing passes a
 * larger override (`h-14`/`sm:h-16`). The `alt` text provides the accessible
 * brand name.
 */
export function RuneSpaceBrand({
  className = "block h-auto w-auto max-h-11 max-w-[min(52vw,100%)] sm:max-h-12 sm:max-w-[min(13rem,100%)]",
  sizes = "192px",
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
