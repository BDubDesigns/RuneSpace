import type { LocationDefinition } from "@/game/schemas/locations";

export type MapIconKey = LocationDefinition["presentation"]["mapIconKey"];

export const MAP_IDENTIFIER_ASSET_BY_KEY = {
  crash_site_deposit: "/map-icons/crash-site.png",
  processing_yard: "/map-icons/processing-yard.png",
  power_annex: "/map-icons/power-annex.png",
} as const satisfies Record<MapIconKey, string>;

/**
 * Resolve the local decorative identifier asset for a location's mapIconKey.
 * Single boundary — no second identifier field. The three approved PNG assets
 * are the production source (1536x1536, grayscale isometric on transparent-aware
 * rendering with low opacity).
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
