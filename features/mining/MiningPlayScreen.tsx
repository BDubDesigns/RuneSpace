"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { ActionLink } from "@/components/ui/ActionLink";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { PlayBoundaryTestTrigger } from "@/features/diagnostics/PlayBoundaryTestTrigger";
import type { MiningGameplayState } from "@/server/mining";
import { MiningConsole } from "./MiningConsole";
import { MiningPlayProvider, useMiningPlay } from "./MiningPlayContext";

function MiningFooter() {
  const { inventoryTrigger, setInventoryOpen, state } = useMiningPlay();
  const totalSlots = state.inventory.slotsUsed + state.inventory.slotsAvailable;
  return (
    <div className="mx-auto flex w-full max-w-xl gap-2 sm:max-w-7xl sm:justify-end">
      <ActionLink
        aria-label="Characters"
        className="flex-1 sm:flex-none"
        href="/characters"
        intent="secondary"
      >
        Chars
      </ActionLink>
      <ActionButton
        ref={inventoryTrigger}
        className="flex-[1.4] sm:flex-none"
        intent="secondary"
        onClick={() => setInventoryOpen(true)}
      >
        Inventory {state.inventory.slotsUsed}/{totalSlots}
      </ActionButton>
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
      <GameShell
        bottomNav={<MiningFooter />}
        topBar={
          <div className="flex items-center justify-between gap-3">
            <TopBar title="RuneSpace" detail="Crash Site Mining" />
            <SignOutButton />
          </div>
        }
      >
        <PlayBoundaryTestTrigger />
        <MiningConsole characterName={characterName} />
      </GameShell>
    </MiningPlayProvider>
  );
}
