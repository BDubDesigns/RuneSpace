"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ActionLink } from "@/components/ui/ActionLink";
import { Panel } from "@/components/ui/Panel";
import { LocationSceneHeader } from "@/features/location-scene/LocationSceneHeader";
import type { LocalPlaceSurface as LocalPlaceSurfaceState } from "@/game/domain/local-places";

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
 * That card arrives as a `resident` slot and sits directly under the
 * description, above whatever gameplay the place hosts, so the person in front
 * of the player is never pushed below the place's activity UI on a phone.
 *
 * A place may also host gameplay of its own — Holo Hollow's Crew Stop is the
 * first (#172). That is no longer composed inside this panel: since #193 a
 * place's activity is a sibling panel (`features/location-scene/
 * LocationActivity`), exactly like a World Location's, so the two kinds of
 * place present their gameplay identically and the player meets the same
 * layout wherever they stand.
 */
export function LocalPlaceSurface({
  characterName,
  parentDisplayName,
  resident,
  surface,
}: {
  characterName: string;
  parentDisplayName: string;
  resident?: ReactNode;
  surface: LocalPlaceSurfaceState;
}) {
  const pathname = usePathname();

  return (
    <Panel tone="raised" className="overflow-hidden !p-0" data-local-place-surface={surface.id}>
      <LocationSceneHeader characterName={characterName} location={surface} />
      <div className="p-5">
        {/* No heading line here (#193) — same reason as the World Location
            surface: the scene plate names the place and owns the `h1`. */}
        <p
          className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]"
          data-local-place-description
          data-local-place-repaired={
            surface.repaired === undefined ? undefined : String(surface.repaired)
          }
        >
          {surface.description}
        </p>
        {resident}
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
