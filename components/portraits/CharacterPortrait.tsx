import Image from "next/image";
import type { CharacterPortraitPresentation } from "@/game/domain/character-portrait";

/**
 * One square character portrait (issue #65).
 *
 * Shared presentation for a resolved portrait value:
 * - a selected catalog portrait renders its committed optimized derivative
 *   through the normal `next/image` boundary with the catalog's intrinsic
 *   dimensions and a responsive `sizes` hint — never a high-resolution master;
 * - the neutral system placeholder renders the decorative silhouette (fully
 *   `aria-hidden`: the adjacent identity text carries the accessible name,
 *   and a first-letter glyph would read like a numeric stat).
 *
 * The wrapper keeps the stable square aspect ratio and the
 * `data-character-portrait` identity used by the profile panel and tests.
 */
export function CharacterPortrait({
  presentation,
  sizes,
  className = "",
  bordered = true,
}: {
  presentation: CharacterPortraitPresentation;
  /** Responsive `sizes` hint for the next/image derivative. */
  sizes: string;
  /** Size the wrapper with a square class such as `h-20 w-20`. */
  className?: string;
  /** Whether the wrapper draws the standard structural border. */
  bordered?: boolean;
}) {
  if (presentation.kind === "placeholder") {
    return (
      <div
        aria-hidden="true"
        className={`grid place-items-center bg-[color:var(--rs-surface-raised)] ${
          bordered ? "border border-[color:var(--rs-border-structural)]" : ""
        } ${className}`}
        data-character-portrait
      >
        <svg
          aria-hidden="true"
          className="h-1/2 w-1/2 text-[color:var(--rs-text-muted)]"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`grid overflow-hidden bg-[color:var(--rs-surface-raised)] ${
        bordered ? "border border-[color:var(--rs-border-structural)]" : ""
      } ${className}`}
      data-character-portrait
    >
      <Image
        alt={presentation.accessibleDescription}
        className="h-full w-full object-cover"
        height={presentation.derivativeHeight}
        sizes={sizes}
        src={presentation.derivativePath}
        width={presentation.derivativeWidth}
      />
    </div>
  );
}
