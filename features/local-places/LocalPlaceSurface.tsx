"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LocationSceneHeader } from "@/features/location-scene/LocationSceneHeader";
import { TradePanel } from "@/features/trade/TradePanel";
import { getMerchant } from "@/game/content/merchants";
import { getNpc } from "@/game/content/npcs";
import type { LocalPlaceDefinition } from "@/game/schemas/local-places";

/**
 * The inside of one Local Place.
 *
 * Presentation only: being here is a route, not a position. The player's
 * authoritative location is still the parent World Location, which is why the
 * way back is an ordinary link rather than a travel command.
 *
 * A place presents the features it owns as explicit actions rather than
 * unfolding them on arrival. Trade is one such action, kept deliberately
 * separate from Talk: the conversation hub stays the canonical NPC surface and
 * never carries a merchant command, so a later Mission can require the
 * conversation independently of any purchase.
 *
 * Whether the Trade surface is open is ordinary ephemeral UI state, like the
 * Inventory drawer — the route carries which place is open, not what the player
 * has expanded inside it.
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
  const [tradeOpen, setTradeOpen] = useState(false);
  const merchant = place.merchantId ? getMerchant(place.merchantId) : undefined;
  const merchantName = merchant ? getNpc(merchant.npcId)?.displayName : undefined;

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
          <div className="mt-5" data-local-place-actions>
            <ActionButton
              aria-controls={tradeOpen ? `local-place-trade-${place.id}` : undefined}
              aria-expanded={tradeOpen}
              data-local-place-action="trade"
              intent={tradeOpen ? "secondary" : "primary"}
              onClick={() => setTradeOpen((open) => !open)}
            >
              {tradeOpen ? "Close trade" : `Trade with ${merchantName ?? "the shopkeeper"}`}
            </ActionButton>
          </div>
        ) : null}
        {merchant && tradeOpen ? (
          <div
            className="mt-5"
            data-local-place-feature="merchant"
            id={`local-place-trade-${place.id}`}
          >
            <TradePanel localPlaceId={place.id} merchant={merchant} />
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
