"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { ActionLink } from "@/components/ui/ActionLink";
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
 * That link is still the only way out, so it is dressed as a real control
 * rather than a breadcrumb (#175): a shared `secondary` ActionLink, on the
 * ordinary dark control surface, with the 44px target and beveled focus ring
 * every other control has. Its arrow is decorative — the parent location's
 * name carries the meaning, and it wraps rather than overflowing a phone.
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
        <div className="mt-5">
          <ActionLink
            className="max-w-full gap-2 text-left"
            data-local-place-exit
            href={pathname}
            intent="secondary"
          >
            <ArrowLeft aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
            <span className="min-w-0 break-words">Back to {parentDisplayName}</span>
          </ActionLink>
        </div>
      </div>
    </Panel>
  );
}
