"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { ActionLink } from "@/components/ui/ActionLink";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { RuneSpaceBrand } from "@/components/branding/RuneSpaceBrand";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { PlayBoundaryTestTrigger } from "@/features/diagnostics/PlayBoundaryTestTrigger";
import type { PlayGameplayState } from "@/server/play";
import { PlayConsole } from "./PlayConsole";
import { PlayProvider, usePlay } from "./PlayContext";

function PlayFooter() {
  const { equipmentTrigger, inventoryTrigger, setEquipmentOpen, setInventoryOpen, state } =
    usePlay();
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
