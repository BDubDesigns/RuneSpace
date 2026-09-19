import type { RepairMaterialProjection } from "@/server/play";

/**
 * Shared presentation helpers for a repair's authored material list (#209).
 *
 * Every repair surface renders whatever rows the recipe has, so none of them
 * may hold the knowledge that the Cargo Hold wants Ferrite and Slag or that the
 * Deep Jag brace wants Power Cells. These two functions are the whole of what
 * the surfaces needed in common; anything more specific stays in the panel that
 * actually renders it.
 */

/**
 * The exact contribution the projection says the player could hand over now,
 * keyed by item ID.
 *
 * Surfaces send this back to the authoritative command verbatim rather than
 * recomputing a quantity of their own, so a plan that went stale between render
 * and click is refused instead of silently installing a different amount.
 */
export function plannedContribution(
  materials: readonly RepairMaterialProjection[],
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    materials.map((material) => [material.itemId, material.availableContribution]),
  );
}

/**
 * "7 Refined Ferrite and 2 Power Cells", from a quantity map and the material
 * rows that carry the authoritative display names. Zero quantities are left
 * out: a player who hands over only Ferrite should not be told about the Power
 * Cells they did not hand over.
 */
export function describeMaterialQuantities(
  quantities: Readonly<Record<string, number>>,
  materials: readonly RepairMaterialProjection[],
): string {
  const parts = materials
    .filter((material) => (quantities[material.itemId] ?? 0) > 0)
    .map((material) => `${quantities[material.itemId]} ${material.name}`);
  if (parts.length === 0) return "nothing";
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
