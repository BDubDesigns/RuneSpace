"use client";

import Image from "next/image";
import type { LocationDefinition } from "@/game/schemas/locations";

export type LocationSceneHeaderProps = {
  location: LocationDefinition;
  characterName: string;
  /** Contextual plates (e.g. FERRITE SHALE at Crash Site, REFINED FERRITE +
      SLAG at the Processing Yard). Stacked bottom-right; omit to hide. */
  resourceLabels?: readonly string[];
};

export function LocationSceneHeader({
  location,
  characterName,
  resourceLabels,
}: LocationSceneHeaderProps) {
  const scene = location.presentation.scene;
  // Defensive: schema guarantees scene, but keep truthful if registry is stale.
  if (!scene) return null;
  const focalX = scene.focal?.x ?? 50;
  const focalY = scene.focal?.y ?? 45;

  return (
    <div
      className="rs-location-scene relative overflow-hidden border-b border-[color:var(--rs-border-structural)]"
      data-location-scene={location.id}
      data-testid="location-scene"
    >
      {/* Shared responsive viewport: mobile shallow cinematic strip, desktop taller
          revealing more vertical context. Same asset, tuned by height/aspect.
          390px viewport is canonical mobile constraint — keep vertical cost restrained.
          Mobile is ~366px wide at 390 viewport; desktop's main column can be
          ~890px (GameShell max-w-7xl with 20rem aside) — desktop must be
          proportionally taller so it reveals more top/bottom, not just crops it. */}
      <div className="rs-location-scene-viewport relative h-[126px] w-full overflow-hidden sm:h-[168px] lg:h-[252px]">
        <Image
          src={scene.asset}
          alt={scene.alt}
          width={scene.width}
          height={scene.height}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 92vw, 890px"
          className="h-full w-full object-cover"
          style={{ objectPosition: `${focalX}% ${focalY}%` }}
          priority={false}
        />
        {/* Subtle dark blend + top/bottom scrim so plates feel mounted, and scene
            fades into the surrounding raised panel without a hard edge.
            All rgba values are via --rs-* tokens owned by app/globals.css. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[var(--rs-scene-scrim-top)] via-transparent via-[55%] to-[var(--rs-scene-scrim-bottom)]"
        />
        {/* Restrained edge treatment: thin cyan top hairline + faint amber lower accent.
            Both are token-driven and low-opacity so art stays dominant. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--rs-scene-hairline-cyan)] opacity-80"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[var(--rs-scene-hairline-amber)] opacity-60"
        />
        {/* Upper plate: location eyebrow. Real UI over scene. Resource pill now lives
            bottom-right so long names (e.g. DeWhat? Emergency Power Annex) never
            get clipped by a top-row sibling. Eyebrow translucency is token-owned. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-start p-2 sm:p-2.5">
          <span
            className="rs-map-plate rs-map-plate--state inline-flex max-w-[92%] items-center whitespace-nowrap px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.14em] sm:px-2.5 sm:text-[11px]"
            style={
              {
                ["--rs-plate-surface-top" as unknown as string]: "var(--rs-scene-plate-top)",
                ["--rs-plate-surface-bottom" as unknown as string]: "var(--rs-scene-plate-bottom)",
              } as React.CSSProperties
            }
            data-scene-eyebrow
          >
            {location.displayName.toUpperCase()}
          </span>
        </div>
        {/* Character name — opaque plate over the bottom-left of the image, right edge
            angled to match concept art. Truncates if the player chose an insanely
            long name so it never collides with the bottom-right resource pill. */}
        <div
          className="absolute bottom-0 left-0 max-w-[58%] truncate border-y border-r border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-1.5 pr-6 font-display text-sm font-semibold tracking-tight text-[color:var(--rs-text-primary)] [clip-path:polygon(0_0,calc(100%_-_14px)_0,100%_100%,0_100%)] sm:max-w-[52%] sm:px-4 sm:py-2 sm:pr-9 sm:text-[15px] sm:[clip-path:polygon(0_0,calc(100%_-_18px)_0,100%_100%,0_100%)]"
          data-scene-character
        >
          {characterName}
        </div>
        {resourceLabels && resourceLabels.length > 0 ? (
          <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1 sm:bottom-2.5 sm:right-2.5">
            {resourceLabels.map((label) => (
              <span
                className="inline-flex max-w-[48%] items-center justify-center whitespace-nowrap border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-surface-panel)] px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wide text-[color:var(--rs-accent-mining)] sm:px-2.5 sm:text-[11px]"
                data-scene-resource
                key={label}
              >
                {label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Registry-owned scene resolution: authoritative location → scene metadata (or undefined). */
export function resolveLocationScene(
  getLocation: (id: string) => LocationDefinition | undefined,
  locationId: string,
): LocationDefinition["presentation"]["scene"] | undefined {
  return getLocation(locationId)?.presentation.scene;
}
