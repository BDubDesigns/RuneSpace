import { getNpc, npcCanStandAt } from "@/game/content/npcs";
import type { LocalPlaceDefinition } from "@/game/schemas/local-places";
import type { LocationDefinition } from "@/game/schemas/locations";
import type { MerchantDefinition } from "@/game/schemas/merchants";

/**
 * One place a merchant does business (#375).
 *
 * A merchant is a business, and a business can keep several venues: Last Leg
 * Trading has Toll's counter, a Local Place at Holo Hollow Landing, and an
 * automated terminal hosted by Stillreach Landing Station. The venues are read
 * from the content that names them (a Local Place's or a World Location's
 * `merchantId`), never restated, so a new venue appears with no edit here. They
 * all trade as the one merchant, so prices, unlock and daily allowances are
 * shared.
 */
export type MerchantVenue = {
  locationId: string;
  /** Present when the venue is a Local Place inside `locationId`. */
  localPlaceId?: string;
  /** The Local Place's own access rule, when the venue is one. */
  place?: LocalPlaceDefinition;
  /**
   * The resident who fronts this venue. Absent for an automated terminal: the
   * merchant's NPC is not standing there, so no source may credit them.
   */
  npcId?: string;
};

/** Every venue of one merchant, Local Places first, in authored order. */
export function merchantVenues(
  merchant: MerchantDefinition,
  registries: {
    localPlaces: readonly LocalPlaceDefinition[];
    locations: readonly LocationDefinition[];
  },
): readonly MerchantVenue[] {
  const npc = getNpc(merchant.npcId);
  const fronted = (locationId: string, localPlaceId?: string) =>
    npc !== undefined && npcCanStandAt(npc, locationId, localPlaceId)
      ? { npcId: merchant.npcId }
      : {};
  return [
    ...registries.localPlaces
      .filter((place) => place.merchantId === merchant.id)
      .map((place) => ({
        locationId: place.parentLocationId,
        localPlaceId: place.id,
        place,
        ...fronted(place.parentLocationId, place.id),
      })),
    ...registries.locations
      .filter((location) => location.merchantId === merchant.id)
      .map((location) => ({ locationId: location.id, ...fronted(location.id) })),
  ];
}
