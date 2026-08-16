"use client";

import Image from "next/image";
import type { LocationDefinition } from "@/game/schemas/locations";

export type LocationSceneHeaderProps = {
  location: LocationDefinition;
  characterName: string;
  /** Upper-right contextual plate (e.g. FERRITE SHALE at Crash Site). Omit to hide. */
  resourceLabel?: string;
};

export function LocationSceneHeader({
  location,
  characterName,
  resourceLabel,
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
          390px viewport is canonical mobile constraint — keep vertical cost restrained. */}
      <div className="rs-location-scene-viewport relative h-[126px] w-full overflow-hidden sm:h-[168px] lg:h-[196px]">
        <Image
          src={scene.asset}
          alt={scene.alt}
          width={scene.width}
          height={scene.height}
          sizes="(max-width: 640px) 100vw, 640px"
          className="h-full w-full object-cover"
          style={{ objectPosition: `${focalX}% ${focalY}%` }}
          priority={false}
        />
        {/* Subtle dark blend + top/bottom scrim so plates feel mounted, and scene
            fades into the surrounding raised panel without a hard edge. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[rgb(5_9_15/0.22)] via-transparent via-[55%] to-[rgb(5_9_15/0.72)]"
        />
        {/* Restrained edge treatment: thin cyan top hairline + faint amber lower accent.
            Both are token-driven and low-opacity so art stays dominant. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(75,216,245,0.55),transparent)] opacity-80"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(245,196,81,0.45),transparent)] opacity-60"
        />
        {/* Upper plates: eyebrow left, resource/context plate right. Real UI over scene. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2 sm:p-2.5">
          <span
            className="rs-map-plate rs-map-plate--state inline-flex max-w-[58%] items-center whitespace-nowrap px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.14em] sm:px-2.5 sm:text-[11px]"
            data-scene-eyebrow
          >
            {location.displayName.toUpperCase()}
          </span>
          {resourceLabel ? (
            <span
              className="rs-map-plate inline-flex max-w-[42%] items-center justify-center whitespace-nowrap border-[rgba(245,196,81,0.28)] bg-[linear-gradient(180deg,rgba(245,196,81,0.12),rgba(91,70,18,0.22))] px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wide text-[color:var(--rs-accent-mining)] sm:px-2.5 sm:text-[11px]"
              data-scene-resource
            >
              {resourceLabel}
            </span>
          ) : null}
        </div>
      </div>
      {/* Lower integrated character band at scene boundary — dark plate, not baked pixels.
          Sits flush to the viewport bottom edge and bleeds into the panel's raised surface. */}
      <div
        className="rs-location-scene-lower relative flex items-center border-t border-[color:var(--rs-border-structural)] bg-[linear-gradient(180deg,rgba(9,21,34,0.98),rgba(5,14,24,0.98))] px-3 py-2 sm:px-4 sm:py-2.5"
        data-scene-lower
      >
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(75,216,245,0.18),transparent)]"
          aria-hidden="true"
        />
        <p
          className="font-display text-sm font-semibold tracking-tight text-[color:var(--rs-text-primary)] sm:text-[15px]"
          data-scene-character
        >
          {characterName}
        </p>
        <span className="ml-auto hidden font-display text-[10px] uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)] sm:inline">
          location
        </span>
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
