import { getMission, type MissionItemOffer } from "@/game/content/missions";
import type { MissionProjection } from "@/game/domain/missions";

/**
 * One Mission a carried item currently offers (#369): the authored copy and the
 * Mission it accepts. The projection decides WHETHER an offer exists (not
 * accepted, prerequisites held, a stack genuinely carried); the content decides
 * what it says. Presentation only: the server revalidates the offer, the carried
 * stack and every eligibility rule when it is accepted.
 */
export type ItemOfferView = {
  missionId: string;
  missionTitle: string;
  offer: MissionItemOffer;
};

/**
 * The offer a carried stack of `itemId` currently makes, if any. Item-keyed and
 * Mission-agnostic, so no Inventory code names a particular item or Mission.
 */
export function itemOfferForItem(
  state: { missions: readonly Pick<MissionProjection, "missionId" | "itemOffer">[] },
  itemId: string,
): ItemOfferView | undefined {
  const projection = state.missions.find((mission) => mission.itemOffer?.itemIds.includes(itemId));
  const definition = projection ? getMission(projection.missionId) : undefined;
  if (!projection || !definition?.itemOffer) return undefined;
  return {
    missionId: definition.id,
    missionTitle: definition.title,
    offer: definition.itemOffer,
  };
}
