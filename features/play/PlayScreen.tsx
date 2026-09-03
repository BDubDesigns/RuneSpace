"use client";

import { Backpack, Shield, ScrollText, Users } from "lucide-react";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { RuneSpaceBrand } from "@/components/branding/RuneSpaceBrand";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { PlayBoundaryTestTrigger } from "@/features/diagnostics/PlayBoundaryTestTrigger";
import type { PlayGameplayState } from "@/server/play";
import { PlayConsole } from "./PlayConsole";
import { PlayProvider, usePlay } from "./PlayContext";
import { FooterNavButton, FooterNavLink } from "./PlayFooterNav";

function PlayFooter() {
  const {
    equipmentTrigger,
    inventoryTrigger,
    missionsTrigger,
    setEquipmentOpen,
    setInventoryOpen,
    setMissionsOpen,
    setMissionsFocus,
    inventoryOpen,
    equipmentOpen,
    missionsOpen,
    state,
  } = usePlay();
  const totalSlots = state.inventory.slotsUsed + state.inventory.slotsAvailable;
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
        compactLabel="Chars"
      />
      <FooterNavButton
        active={inventoryOpen}
        aria-label={`Inventory, ${state.inventory.slotsUsed} of ${totalSlots} slots used`}
        icon={<Backpack />}
        label="Inventory"
        compactLabel="Inv."
        onClick={() => {
          setEquipmentOpen(false);
          setMissionsOpen(false);
          setInventoryOpen(true);
        }}
        ref={inventoryTrigger}
      />
      <FooterNavButton
        active={equipmentOpen}
        aria-label="Equipment"
        icon={<Shield />}
        label="Equipment"
        compactLabel="Equip"
        onClick={() => {
          setInventoryOpen(false);
          setMissionsOpen(false);
          setEquipmentOpen(true);
        }}
        ref={equipmentTrigger}
      />
      <FooterNavButton
        active={missionsOpen}
        aria-label={readyCount > 0 ? `Missions, ${readyCount} ready to turn in` : "Missions"}
        badgeCount={readyCount}
        icon={<ScrollText />}
        label="Missions"
        compactLabel="Miss."
        onClick={() => {
          setInventoryOpen(false);
          setEquipmentOpen(false);
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
  return (
    <PlayProvider initialState={initialState}>
      <GameShell bottomNav={<PlayFooter />} topBar={<PlayTopBar />}>
        <PlayBoundaryTestTrigger />
        <PlayConsole characterName={characterName} />
      </GameShell>
    </PlayProvider>
  );
}
