"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { ActionLink } from "@/components/ui/ActionLink";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { RuneSpaceBrand } from "@/components/branding/RuneSpaceBrand";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { PlayBoundaryTestTrigger } from "@/features/diagnostics/PlayBoundaryTestTrigger";
import { getLocation } from "@/game/content/locations";
import type { MiningGameplayState } from "@/server/mining";
import { MiningConsole } from "./MiningConsole";
import { MiningPlayProvider, useMiningPlay } from "./MiningPlayContext";

function MiningFooter() {
  const { equipmentTrigger, inventoryTrigger, setEquipmentOpen, setInventoryOpen, state } =
    useMiningPlay();
  const totalSlots = state.inventory.slotsUsed + state.inventory.slotsAvailable;
  return (
    <div className="mx-auto flex w-full max-w-xl gap-2 sm:max-w-7xl sm:justify-end">
      <ActionLink
        aria-label="Characters"
        className="flex-1 whitespace-nowrap sm:flex-none"
        href="/characters"
        intent="secondary"
      >
        Chars
      </ActionLink>
      <ActionButton
        ref={inventoryTrigger}
        className="flex-[1.4] whitespace-nowrap sm:flex-none"
        intent="secondary"
        onClick={() => {
          setEquipmentOpen(false);
          setInventoryOpen(true);
        }}
      >
        Inventory {state.inventory.slotsUsed}/{totalSlots}
      </ActionButton>
      <ActionButton
        ref={equipmentTrigger}
        className="flex-1 whitespace-nowrap sm:flex-none"
        intent="secondary"
        onClick={() => {
          setInventoryOpen(false);
          setEquipmentOpen(true);
        }}
      >
        Equipment
      </ActionButton>
    </div>
  );
}

function PlayTopBar() {
  const { state } = useMiningPlay();
  const detail = state.travelState
    ? `In transit to ${getLocation(state.travelState.destinationLocationId)?.displayName ?? ""}`
    : (getLocation(state.location.currentLocationId)?.displayName ?? "Location");
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <TopBar title={<RuneSpaceBrand />} detail={detail} />
      </div>
      <SignOutButton />
    </div>
  );
}

export function MiningPlayScreen({
  characterName,
  initialState,
}: {
  characterName: string;
  initialState: MiningGameplayState;
}) {
  return (
    <MiningPlayProvider initialState={initialState}>
      <GameShell bottomNav={<MiningFooter />} topBar={<PlayTopBar />}>
        <PlayBoundaryTestTrigger />
        <MiningConsole characterName={characterName} />
      </GameShell>
    </MiningPlayProvider>
  );
}
