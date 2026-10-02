"use client";

import { Backpack, Mail, Map as MapIcon, ScrollText, User } from "lucide-react";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { ActionLink } from "@/components/ui/ActionLink";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { RuneSpaceBrand } from "@/components/branding/RuneSpaceBrand";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { PlayBoundaryTestTrigger } from "@/features/diagnostics/PlayBoundaryTestTrigger";
import { LOCAL_PLACE_PARAM } from "@/features/local-places/navigation";
import { ChatProvider } from "@/features/chat/ChatContext";
import { PlayerTradeProvider } from "@/features/player-trade/PlayerTradeContext";
import { PlayerTradeSurface } from "@/features/player-trade/PlayerTradeSurface";
import { SocialLauncher } from "@/features/social/ChatSocialLauncher";
import { SocialProvider } from "@/features/social/SocialContext";
import { MissionObjectivesRegion } from "@/features/missions/MissionObjectivesRegion";
import { acknowledgeNewsAction } from "@/server/actions";
import type { CharacterPortraitPresentation } from "@/game/domain/character-portrait";
import type { PlayGameplayState } from "@/server/play";
import { PlayConsole } from "./PlayConsole";
import { PlayProvider, usePlay } from "./PlayContext";
import { FooterNavButton, FooterNavLink } from "./PlayFooterNav";
import { PlayUtilityWorkspace } from "./PlayUtilityWorkspace";
import { PlayViewSwitch } from "./PlayViewSwitch";
import { useDesktopWorkspace } from "./workspace-presentation";

function PlayFooter() {
  const pathname = usePathname();
  const mapActive = useSearchParams().get("surface") === "map";
  const {
    characterOpen,
    characterTrigger,
    inventoryTrigger,
    missionsTrigger,
    openCharacter,
    openInventory,
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
      <FooterNavButton
        active={characterOpen}
        aria-label="Character"
        icon={<User />}
        label="Character"
        onClick={openCharacter}
        ref={characterTrigger}
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
 * Unread adds the dedicated `--rs-glow-news-unread` attention token (see
 * `app/globals.css`) as an exterior halo — derived from the same
 * `--rs-accent-primary` cyan as `--rs-glow-primary`, but deliberately
 * stronger since this needs to read as an attention affordance, not
 * restrained panel ambiance; kept separate from the mission
 * guidance/available tokens since those already carry gameplay meaning this
 * control doesn't share. Two things keep it from silently doing nothing:
 * - `ActionButton` always carries `rs-bevel`, whose clip-path clips any
 *   shadow drawn outside the element's own box (see `.rs-bevel` and the
 *   `.rs-bevel.rs-mission-guidance` note in `app/globals.css`), so the glow
 *   is applied to the unclipped `<form>` wrapper around the button rather
 *   than the beveled button itself; `rs-bevel` stays untouched.
 * - Tailwind's `shadow-[var(...)]` arbitrary-value syntax only sets the
 *   `--tw-shadow-color`/`--tw-shadow` custom properties, not the `box-shadow`
 *   property itself, unless a base `shadow` utility is also present (verified
 *   in the compiled CSS — this silently does nothing on its own, which is
 *   also true of the header's existing identical usage). An inline style sets
 *   `box-shadow` directly instead, avoiding that ambiguity.
 * The halo drops away completely once acknowledged; `.rs-focus:focus-visible`
 * sets `outline` on the button, a separate property from the wrapper's
 * `box-shadow`, so it never interferes with the focus ring.
 */
function NewsControl({ unread }: { unread: boolean }) {
  return (
    <form
      action={acknowledgeNewsAction}
      className="inline-flex"
      style={unread ? { boxShadow: "var(--rs-glow-news-unread)" } : undefined}
    >
      <ActionButton
        aria-label={unread ? "News, unread update available" : "News"}
        className="relative px-2.5"
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

/**
 * The desktop rail (#286): Current Missions at the top — the authoritative strips,
 * compact and height-bounded — and the dockable utility workspace below it. It is
 * mounted for the whole Play page, so Map ↔ Location and travel re-render its
 * contents without remounting the workspace, the selected utility, or the Chat
 * state and realtime stream above it. Below desktop width the shell hides the
 * rail and `PlayUtilityWorkspace` renders the phone's modal Drawers instead.
 */
function PlayRail({
  characterId,
  characterName,
  characterPortrait,
}: {
  characterId: string;
  characterName: string;
  characterPortrait: CharacterPortraitPresentation;
}) {
  const desktop = useDesktopWorkspace();
  const { state } = usePlay();
  return (
    <>
      {desktop === true ? <MissionObjectivesRegion state={state} /> : null}
      <PlayUtilityWorkspace
        characterId={characterId}
        characterName={characterName}
        characterPortrait={characterPortrait}
      />
    </>
  );
}

function PlayTopBar({ newsUnread, mapControl }: { newsUnread: boolean; mapControl?: ReactNode }) {
  return (
    <TopBar
      title={<RuneSpaceBrand />}
      trailing={
        <div className="flex items-center gap-2">
          {mapControl ? <div className="hidden xl:block">{mapControl}</div> : null}
          <NewsControl unread={newsUnread} />
          <SignOutButton />
        </div>
      }
    />
  );
}

export function PlayScreen({
  characterName,
  characterPortrait,
  initialState,
  newsUnread,
}: {
  characterName: string;
  /** Resolved server-side through the narrow portrait boundary (#65, #98). */
  characterPortrait: CharacterPortraitPresentation;
  initialState: PlayGameplayState;
  newsUnread: boolean;
}) {
  return (
    <PlayProvider initialState={initialState}>
      <PlayWorkspace
        characterName={characterName}
        characterPortrait={characterPortrait}
        newsUnread={newsUnread}
      />
    </PlayProvider>
  );
}

function PlayWorkspace({
  characterName,
  characterPortrait,
  newsUnread,
}: {
  characterName: string;
  characterPortrait: CharacterPortraitPresentation;
  newsUnread: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapActive = searchParams.get("surface") === "map";
  const localPlaceId = searchParams.get(LOCAL_PLACE_PARAM) ?? undefined;
  const { closeUtilityPanel, openUtilityId, openUtilityPanel, state } = usePlay();
  const desktop = useDesktopWorkspace();
  const characterId = state.characterId;
  const onMapExit = () => router.replace(pathname);

  return (
    <>
      {/* Chat/Social (#245) is a utility over Play, like Inventory: below
          desktop width its launcher floats above the footer and its Drawer
          opens over the current surface without navigating; at desktop width
          it is one tab of the docked utility workspace (#286). It never feeds
          Play state; a promoted Trade ad (#246) only asks Play to re-read its
          Credits. Its open intent is the same single open utility Inventory,
          Character and the Mission Log use, so selecting one never leaves
          another's Drawer or focus trap behind. ChatProvider (#247) keeps
          Whisper unread and the view live while Chat is not mounted, so
          character surfaces can open a Whisper. PlayerTradeProvider (#268)
          mirrors the durable trade state: request cards pinned in
          Chat/Social, the profile's Trade action, and the accepted-trade
          surface over Play — which stays a foreground modal at every width. */}
      <SocialProvider
        characterId={characterId}
        onOpenChange={(open) => (open ? openUtilityPanel("chat") : closeUtilityPanel("chat"))}
        open={openUtilityId === "chat"}
      >
        <ChatProvider characterId={characterId}>
          <PlayerTradeProvider characterId={characterId}>
            <GameShell
              bottomNav={<PlayFooter />}
              desktopRail={
                <PlayRail
                  characterId={characterId}
                  characterName={characterName}
                  characterPortrait={characterPortrait}
                />
              }
              floatingAction={<SocialLauncher />}
              // The Map control is not mounted at all below desktop width (where
              // the footer's Map is the destination); before the browser has
              // answered it renders, hidden by CSS below `xl`.
              topBar={
                <PlayTopBar
                  mapControl={
                    desktop === false ? undefined : (
                      <PlayViewSwitch
                        inTransit={Boolean(state.travelState)}
                        mapActive={mapActive}
                        onMapExit={onMapExit}
                      />
                    )
                  }
                  newsUnread={newsUnread}
                />
              }
            >
              <PlayBoundaryTestTrigger />
              <PlayConsole
                characterName={characterName}
                localPlaceId={localPlaceId}
                onMapExit={onMapExit}
                surface={mapActive ? "map" : "primary"}
              />
              <PlayerTradeSurface />
            </GameShell>
          </PlayerTradeProvider>
        </ChatProvider>
      </SocialProvider>
    </>
  );
}
