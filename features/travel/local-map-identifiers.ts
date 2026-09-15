import type { LocationDefinition } from "@/game/schemas/locations";

export type MapIconKey = LocationDefinition["presentation"]["mapIconKey"];

export const MAP_IDENTIFIER_ASSET_BY_KEY = {
  crash_site_deposit: "/map-icons/crash-site.webp",
  processing_yard: "/map-icons/processing-yard.webp",
  power_annex: "/map-icons/power-annex.webp",
  the_long_scramble: "/map-icons/the-long-scramble.webp",
  the_jag: "/map-icons/the-jag.webp",
  holo_hollow: "/map-icons/holo-hollow.webp",
  rusk_recovery: "/map-icons/rusk-recovery.webp",
} as const satisfies Record<MapIconKey, string>;

/**
 * Resolve the local decorative identifier asset for a location's mapIconKey.
 * Single boundary — no second identifier field. Every approved identifier is the
 * same production derivative (tightly cropped, transparent, grayscale, 512
 * long-edge, lossless WebP) rendered with low opacity. The Jag and The Long
 * Scramble were the last two legacy 1254x1254 PNGs; issue #117 re-prepared them
 * through that same contract, and their masters live in `assets/map-icons/`.
 */
export function resolveMapIdentifierAsset(mapIconKey: MapIconKey): string {
  return MAP_IDENTIFIER_ASSET_BY_KEY[mapIconKey];
}

/**
 * Convenience: resolve directly from a location id via the registry.
 * Returns undefined if the location or its key is unknown — callers must
 * handle the fallback (no identifier rendered).
 */
export function resolveMapIdentifierAssetForLocation(
  getLocation: (id: string) => LocationDefinition | undefined,
  locationId: string,
): string | undefined {
  const location = getLocation(locationId);
  if (!location) return undefined;
  return resolveMapIdentifierAsset(location.presentation.mapIconKey);
}
