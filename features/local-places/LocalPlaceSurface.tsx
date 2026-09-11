"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LocationSceneHeader } from "@/features/location-scene/LocationSceneHeader";
import type { LocalPlaceDefinition } from "@/game/schemas/local-places";

/**
 * The inside of one Local Place.
 *
 * Presentation only: being here is a route, not a position. The player's
 * authoritative location is still the parent World Location, which is why the
 * way back is an ordinary link rather than a travel command.
 *
 * The place describes itself; the people in it present their own actions. A
 * place's merchant is offered as Trade on its resident's Local Contact card
 * (features/npc/NpcInteractionPanel), beside Talk, so the player meets one
 * person with several interactions rather than a shop that unfolds on arrival.
 */
export function LocalPlaceSurface({
  characterName,
  parentDisplayName,
  place,
}: {
  characterName: string;
  parentDisplayName: string;
  place: LocalPlaceDefinition;
}) {
  const pathname = usePathname();

  return (
    <Panel tone="raised" className="overflow-hidden !p-0" data-local-place-surface={place.id}>
      <LocationSceneHeader characterName={characterName} location={place} />
      <div className="p-5">
        <SectionHeader eyebrow={place.displayName}>Local place</SectionHeader>
        <p
          className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]"
          data-local-place-description
        >
          {place.description}
        </p>
        <div className="mt-4">
          <Link
            className="rs-focus inline-flex items-center font-display text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--rs-accent-primary)] hover:underline"
            data-local-place-exit
            href={pathname}
          >
            ← Back to {parentDisplayName}
          </Link>
        </div>
      </div>
    </Panel>
  );
}
