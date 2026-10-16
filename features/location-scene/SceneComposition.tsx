import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import type { LocationDefinition } from "@/game/schemas/locations";

export type ComposedScene = LocationDefinition["presentation"]["scene"];

/**
 * One scene, composed on a single stage (#351).
 *
 * The opaque background and any transparent overlay are children of **one** stage
 * element that carries the scene's cover/crop transform, so they are cropped,
 * scaled and offset identically at every viewport and an overlay can never slide
 * off the mark it was placed on. The stage reproduces `object-fit: cover` with
 * `object-position: focal` exactly: it is the background's aspect ratio, at least
 * as large as the viewport in both axes, positioned by the same focal percentages.
 * It reads the viewport through container query units, which is why the wrapper is
 * a size container — there is no JavaScript measurement and no per-breakpoint
 * branch, so server-rendered markup is already correct.
 *
 * The caller owns the viewport (a positioned, overflow-clipped box with its own
 * height or aspect ratio); this fills it. A scene with no overlay is the plain
 * background, so every location renders through the same elements and a ship state
 * change swaps only the overlay layer.
 *
 * `children` are further stage-relative layers (#359: the flight cinematic's moving
 * Rivet). They sit above the background and any overlay inside the same stage, so
 * a layer positioned in percent of the stage is cropped and scaled with the art.
 *
 * Accessibility: the scene's `alt` describes the whole composition and is carried
 * by the background image; the overlay is decorative (`alt=""`), so a screen reader
 * hears the place once.
 */
export function SceneComposition({
  scene,
  sizes,
  stageWidthHint,
  priority = false,
  children,
}: {
  scene: ComposedScene;
  /** `sizes` for the background image. */
  sizes: string;
  /**
   * The widest the stage is expected to render, in CSS px. Only used to give the
   * overlay's `sizes` a truthful size so it is not fetched at the stage's full
   * width; it never affects layout.
   */
  stageWidthHint: number;
  /** Preload the background only. Overlays never take a preload. */
  priority?: boolean;
  /** Extra decorative layers placed in percent of the stage. */
  children?: ReactNode;
}) {
  const focalX = scene.focal?.x ?? 50;
  const focalY = scene.focal?.y ?? 45;
  const ratio = scene.width / scene.height;
  const { overlay } = scene;

  const stageStyle: CSSProperties = {
    width: `max(100cqw, calc(100cqh * ${ratio}))`,
    aspectRatio: `${scene.width} / ${scene.height}`,
    left: `${focalX}%`,
    top: `${focalY}%`,
    // The focal point lines the same fraction of the stage up with the same
    // fraction of the viewport, which is what `object-position` means.
    transform: `translate(-${focalX}%, -${focalY}%)`,
  };

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ containerType: "size" }}
      data-scene-composition
    >
      <div className="absolute" style={stageStyle} data-scene-stage>
        <Image
          src={scene.asset}
          alt={scene.alt}
          width={scene.width}
          height={scene.height}
          sizes={sizes}
          className="block h-full w-full"
          data-scene-layer="background"
          // Issue #117: the surface's hero measured as the LCP element, so it is
          // preloaded. Overlays below are deliberately not.
          priority={priority}
        />
        {overlay ? (
          <Image
            src={overlay.asset}
            alt=""
            aria-hidden="true"
            width={overlay.width}
            height={overlay.height}
            sizes={`${Math.ceil((stageWidthHint * overlay.placement.width) / 100)}px`}
            className="pointer-events-none absolute h-auto max-w-none"
            style={{
              left: `${overlay.placement.left}%`,
              top: `${overlay.placement.top}%`,
              width: `${overlay.placement.width}%`,
            }}
            data-scene-layer="overlay"
            // Eager so the ship is there with the scene, but never `priority`: no
            // second preload competes with the background for LCP.
            loading="eager"
          />
        ) : null}
        {children}
      </div>
    </div>
  );
}
