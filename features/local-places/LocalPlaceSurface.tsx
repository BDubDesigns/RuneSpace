"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LocationSceneHeader } from "@/features/location-scene/LocationSceneHeader";
import { TradePanel } from "@/features/trade/TradePanel";
import { getMerchant } from "@/game/content/merchants";
import type { LocalPlaceDefinition } from "@/game/schemas/local-places";

/**
 * The inside of one Local Place.
 *
 * Presentation only: being here is a route, not a position. The player's
 * authoritative location is still the parent World Location, which is why the
 * way back is an ordinary link rather than a travel command.
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
  const merchant = place.merchantId ? getMerchant(place.merchantId) : undefined;

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
        {merchant ? (
          <div className="mt-5" data-local-place-feature="merchant">
            <TradePanel localPlaceId={place.id} merchant={merchant} />
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
