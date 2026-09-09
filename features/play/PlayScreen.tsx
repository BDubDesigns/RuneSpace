"use client";

import { Backpack, Mail, Map as MapIcon, ScrollText, Users } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { RuneSpaceBrand } from "@/components/branding/RuneSpaceBrand";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { PlayBoundaryTestTrigger } from "@/features/diagnostics/PlayBoundaryTestTrigger";
import { acknowledgeNewsAction } from "@/server/actions";
import type { PlayGameplayState } from "@/server/play";
import { PlayConsole } from "./PlayConsole";
import { PlayProvider, usePlay } from "./PlayContext";
import { FooterNavButton, FooterNavLink } from "./PlayFooterNav";

function PlayFooter() {
  const pathname = usePathname();
  const mapActive = useSearchParams().get("surface") === "map";
  const {
    inventoryTrigger,
    missionsTrigger,
    openInventory,
    setInventoryOpen,
    setMissionsOpen,
    setMissionsFocus,
    inventoryOpen,
    missionsOpen,
    state,
  } = usePlay();
  const readyCount = state.missions.filter(
    (mission) => mission.state === "ready_for_completion",
  ).length;
  return (
    <div className="mx-auto flex w-full max-w-xl gap-1.5 sm:max-w-7xl sm:justify-end">
      <FooterNavLink
        active={false}
        aria-label="Characters"
        href="/characters"
        icon={<Users />}
        label="Characters"
      />
      <FooterNavButton
        active={inventoryOpen}
        aria-label={`Inventory, ${state.inventory.slotsAvailable} slots free`}
        freeSlotsCount={state.inventory.slotsAvailable}
        icon={<Backpack />}
        label="Inventory"
        onClick={() => {
          openInventory("inventory");
        }}
        ref={inventoryTrigger}
      />
      <FooterNavLink
        active={mapActive}
        aria-current={mapActive ? "page" : undefined}
        aria-label="Map"
        href={`${pathname}?surface=map`}
        icon={<MapIcon />}
        label="Map"
      />
      <FooterNavButton
        active={missionsOpen}
        aria-label={readyCount > 0 ? `Missions, ${readyCount} ready to turn in` : "Missions"}
        badgeCount={readyCount}
        icon={<ScrollText />}
        label="Missions"
        onClick={() => {
          setInventoryOpen(false);
          setMissionsFocus(undefined);
          setMissionsOpen(true);
        }}
        ref={missionsTrigger}
      />
    </div>
  );
}

/**
 * Account-level unread-news control (issue #156). Submitting the form is an
 * ordinary navigation (works without client JavaScript): the server action
 * advances the authenticated account's news read-through boundary to the
 * newest published Update's instant, then redirects to `/updates`. The
 * unread dot is `aria-hidden`; the real state is folded into the button's
 * `aria-label`, matching the existing footer badge convention.
 *
 * Icon-only with a compact footprint: the header panel's mobile budget is
 * already calibrated around exactly two controls (the brand lockup and Sign
 * out — see `RuneSpaceBrand`'s size contract), so a wider labeled button here
 * would squeeze the lockup below its approved mobile height.
 *
 * Unread adds the existing `--rs-glow-primary` shadow token (already used for
 * the header panel itself) — no new color or shadow recipe, just applied to a
 * smaller control so it reads clearly. It drops away completely once
 * acknowledged; `.rs-focus:focus-visible` sets `outline`, a separate property
 * from `box-shadow`, so the glow never interferes with the focus ring.
 */
function NewsControl({ unread }: { unread: boolean }) {
  return (
    <form action={acknowledgeNewsAction}>
      <ActionButton
        aria-label={unread ? "News, unread update available" : "News"}
        className={`relative px-2.5 ${unread ? "shadow-[var(--rs-glow-primary)]" : ""}`}
        intent="secondary"
        type="submit"
      >
        <Mail aria-hidden="true" className="h-4 w-4" />
        <span className="sr-only">News</span>
        {unread ? (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border border-[color:var(--rs-surface-control)] bg-[color:var(--rs-accent-primary)]"
          />
        ) : null}
      </ActionButton>
    </form>
  );
}

function PlayTopBar({ newsUnread }: { newsUnread: boolean }) {
  return (
    <TopBar
      title={<RuneSpaceBrand />}
      trailing={
        <div className="flex items-center gap-2">
          <NewsControl unread={newsUnread} />
          <SignOutButton />
        </div>
      }
    />
  );
}

export function PlayScreen({
  characterName,
  initialState,
  newsUnread,
}: {
  characterName: string;
  initialState: PlayGameplayState;
  newsUnread: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapActive = searchParams.get("surface") === "map";

  return (
    <PlayProvider initialState={initialState}>
      <GameShell bottomNav={<PlayFooter />} topBar={<PlayTopBar newsUnread={newsUnread} />}>
        <PlayBoundaryTestTrigger />
        <PlayConsole
          characterName={characterName}
          onMapExit={() => router.replace(pathname)}
          surface={mapActive ? "map" : "primary"}
        />
      </GameShell>
    </PlayProvider>
  );
}
