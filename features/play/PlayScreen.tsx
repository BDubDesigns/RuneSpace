"use client";

import { Backpack, Map as MapIcon, ScrollText, Users } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { RuneSpaceBrand } from "@/components/branding/RuneSpaceBrand";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { PlayBoundaryTestTrigger } from "@/features/diagnostics/PlayBoundaryTestTrigger";
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
    setInventoryOpen,
    setInventoryTab,
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
          setMissionsOpen(false);
          setInventoryTab("inventory");
          setInventoryOpen(true);
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

function PlayTopBar() {
  return <TopBar title={<RuneSpaceBrand />} trailing={<SignOutButton />} />;
}

export function PlayScreen({
  characterName,
  initialState,
}: {
  characterName: string;
  initialState: PlayGameplayState;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapActive = searchParams.get("surface") === "map";

  return (
    <PlayProvider initialState={initialState}>
      <GameShell bottomNav={<PlayFooter />} topBar={<PlayTopBar />}>
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
