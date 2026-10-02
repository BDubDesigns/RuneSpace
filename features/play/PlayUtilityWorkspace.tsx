"use client";

import { Backpack, MessagesSquare, ScrollText, User } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import type { DockedUtilityRegion, UtilityPresentation } from "@/components/ui/UtilitySurface";
import { CharacterPanel } from "@/features/characters/CharacterPanel";
import { ChatConversations } from "@/features/chat/ChatConversations";
import { InventoryEquipmentPanel } from "@/features/inventory/InventoryEquipmentPanel";
import { MissionLogPanel } from "@/features/missions/MissionLogPanel";
import { usePlayerTrade } from "@/features/player-trade/PlayerTradeContext";
import { ChatSocialPanel } from "@/features/social/ChatSocialPanel";
import { chatSocialLauncherLabel } from "@/features/social/ChatSocialLauncher";
import type { RealtimeStatus } from "@/features/social/realtime-connection";
import { useSocial } from "@/features/social/SocialContext";
import type { CharacterPortraitPresentation } from "@/game/domain/character-portrait";
import { usePlay } from "./PlayContext";
import {
  dockedUtility,
  nextUtilityTab,
  openIntentForTab,
  PLAY_UTILITY_IDS,
  PLAY_UTILITY_LABELS,
  type PlayUtilityId,
} from "./utility-workspace";
import { useDesktopWorkspace, useHomeUtility } from "./workspace-presentation";

const TAB_ICONS: Record<PlayUtilityId, ReactNode> = {
  chat: <MessagesSquare />,
  inventory: <Backpack />,
  character: <User />,
  missions: <ScrollText />,
};

const tabId = (utility: PlayUtilityId) => `play-utility-tab-${utility}`;
const PANEL_ID = "play-utility-panel";

const badgeClassName =
  "absolute right-1 top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full border px-0.5 font-display text-[9px] font-bold leading-none";

function UtilityTabBadge({ utility, count }: { utility: PlayUtilityId; count: number }) {
  if (count <= 0) return null;
  const tone =
    utility === "missions"
      ? "border-[color:var(--rs-mission-border)] bg-[color:var(--rs-mission-surface-subtle)] text-[color:var(--rs-mission-accent-strong)]"
      : "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-surface-control)] text-[color:var(--rs-accent-primary)] [box-shadow:var(--rs-glow-news-unread)]";
  return (
    <span
      aria-hidden="true"
      className={`${badgeClassName} ${tone}`}
      data-chat-social-attention={utility === "chat" ? count : undefined}
      data-utility-tab-badge={utility}
      data-utility-tab-badge-count={count}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

/**
 * The lower rail's compact tab list: Chat, Inventory, Character, Missions. A
 * real ARIA tab list with a roving tab stop and Left/Right/Home/End, selection
 * following focus, so a keyboard player crosses it with one Tab stop.
 *
 * Chat carries the attention count (unread Whispers, System notices, mentions
 * and pinned requests such as an incoming trade), folded into its accessible
 * name exactly as the phone launcher's is, so a request is never out of sight
 * just because Inventory is the open utility. Missions carries the number
 * ready to turn in, as the phone footer's does.
 */
function UtilityTabs({
  active,
  attentionCount,
  readyCount,
  realtimeStatus,
  onSelect,
  tabRefs,
}: {
  active: PlayUtilityId;
  attentionCount: number;
  readyCount: number;
  /** Exposed on the Chat tab as a data attribute for diagnostics and browser tests only. */
  realtimeStatus: RealtimeStatus;
  onSelect: (utility: PlayUtilityId) => void;
  tabRefs: Record<PlayUtilityId, RefObject<HTMLButtonElement | null>>;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, utility: PlayUtilityId) {
    const next = nextUtilityTab(utility, event.key);
    if (!next) return;
    event.preventDefault();
    onSelect(next);
    tabRefs[next].current?.focus();
  }
  return (
    <div
      aria-label="Play utilities"
      className="grid shrink-0 grid-cols-4 gap-1"
      data-utility-tabs=""
      role="tablist"
    >
      {PLAY_UTILITY_IDS.map((utility) => {
        const selected = utility === active;
        const count = utility === "chat" ? attentionCount : utility === "missions" ? readyCount : 0;
        const label = PLAY_UTILITY_LABELS[utility];
        const accessibleName =
          utility === "chat"
            ? chatSocialLauncherLabel(count)
            : utility === "missions" && count > 0
              ? `${label}, ${count} ready to turn in`
              : label;
        return (
          <button
            aria-controls={selected ? PANEL_ID : undefined}
            aria-label={accessibleName}
            aria-selected={selected}
            className={`rs-bevel rs-focus relative flex min-h-[var(--rs-touch-target)] flex-col items-center justify-center gap-0.5 border px-1 py-1 text-center outline-none transition duration-[var(--rs-duration-fast)] ${
              selected
                ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)] text-[color:var(--rs-accent-primary)]"
                : "border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] text-[color:var(--rs-text-primary)] hover:border-[color:var(--rs-accent-secondary)]"
            }`}
            data-realtime-status={utility === "chat" ? realtimeStatus : undefined}
            data-utility-tab={utility}
            id={tabId(utility)}
            key={utility}
            onClick={() => onSelect(utility)}
            onKeyDown={(event) => onKeyDown(event, utility)}
            ref={tabRefs[utility]}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            <span aria-hidden="true" className="[&>svg]:h-4 [&>svg]:w-4">
              {TAB_ICONS[utility]}
            </span>
            <span className="font-display text-[10px] uppercase leading-none tracking-[0.08em]">
              {label}
            </span>
            <UtilityTabBadge count={count} utility={utility} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The one Play utility presentation coordinator (#286): it reads the single
 * logical open intent in `PlayContext` and mounts exactly one presentation of
 * exactly one utility.
 *
 * - **Below 1280px** only an explicitly opened utility exists, as the modal
 *   Drawer the phone has always had. A passive desktop home never opens one.
 * - **At 1280px and wider** the utility is docked in the right rail: the
 *   explicitly opened one, otherwise this character's home (Chat until they
 *   choose another). The rail has the tab list, and the panel is an ordinary
 *   page region — no `aria-modal`, backdrop, scroll lock, focus trap or
 *   Escape handling.
 * - **Until the browser has answered** (the server render and hydration), and
 *   until the saved home has been read, nothing mounts. That is what stops a
 *   default Chat from mounting — and reading messages — a moment before the
 *   character's real home replaces it.
 *
 * Because the panel is chosen by state and not hidden by CSS, Chat is simply
 * not mounted while Inventory is up: nothing is read behind the player's back
 * and there is no second copy to focus. Its unsent drafts live in `ChatProvider`,
 * so they survive. The one realtime stream lives in `SocialProvider`, above all
 * of this, and is untouched by any switch.
 */
export function PlayUtilityWorkspace({
  characterId,
  characterName,
  characterPortrait,
}: {
  characterId: string;
  characterName: string;
  characterPortrait: CharacterPortraitPresentation;
}) {
  const desktop = useDesktopWorkspace();
  const [home, setHome] = useHomeUtility(characterId);
  const {
    characterTrigger,
    closeUtilityPanel,
    inventoryTrigger,
    missionsFocus,
    missionsTrigger,
    openUtilityId,
    openUtilityPanel,
    state,
  } = usePlay();
  const { attentionCount, status } = useSocial();
  const { state: trade } = usePlayerTrade();
  const tabRefs: Record<PlayUtilityId, RefObject<HTMLButtonElement | null>> = {
    chat: useRef<HTMLButtonElement>(null),
    inventory: useRef<HTMLButtonElement>(null),
    character: useRef<HTMLButtonElement>(null),
    missions: useRef<HTMLButtonElement>(null),
  };
  const railRef = useRef<HTMLDivElement>(null);
  const previousDesktop = useRef(desktop);
  const previousOpen = useRef(openUtilityId);

  // Focus on arrival. Crossing from a phone's modal to the dock, or opening a
  // utility from elsewhere on the page (the objectives' Equipment shortcut, a
  // Whisper started from a message), lands on the docked tab rather than on a
  // control that has just stopped mattering; a tab press already has focus.
  useLayoutEffect(() => {
    const crossed = previousDesktop.current === false && desktop === true;
    const openedElsewhere =
      desktop === true &&
      openUtilityId !== undefined &&
      previousOpen.current !== openUtilityId &&
      !railRef.current?.contains(document.activeElement);
    previousDesktop.current = desktop;
    previousOpen.current = openUtilityId;
    if ((crossed || openedElsewhere) && openUtilityId) tabRefs[openUtilityId].current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, openUtilityId]);

  // The dock already shows the home, so an open intent naming the home — an
  // in-Chat action such as starting a Whisper while Chat is the home, or the
  // Equipment shortcut while Inventory is — adds nothing a phone would have to
  // honour. Settling it to the passive home keeps a later shrink from raising a
  // modal the player never asked for, just as choosing the home tab does.
  useEffect(() => {
    if (desktop === true && home !== undefined && openUtilityId === home) closeUtilityPanel();
  }, [closeUtilityPanel, desktop, home, openUtilityId]);

  if (desktop === undefined) return null;

  const conversations = <ChatConversations characterId={characterId} />;

  if (!desktop) {
    // The phone/tablet composition, unchanged: one modal Drawer for the one
    // explicitly opened utility.
    const modal: UtilityPresentation = "modal";
    switch (openUtilityId) {
      case "inventory":
        return (
          <InventoryEquipmentPanel
            onClose={() => closeUtilityPanel("inventory")}
            presentation={modal}
            state={state}
            triggerRef={inventoryTrigger}
          />
        );
      case "missions":
        return (
          <MissionLogPanel
            focusedMissionId={missionsFocus}
            onClose={() => closeUtilityPanel("missions")}
            presentation={modal}
            state={state}
            triggerRef={missionsTrigger}
          />
        );
      case "character":
        return (
          <CharacterPanel
            characterName={characterName}
            onClose={() => closeUtilityPanel("character")}
            portrait={characterPortrait}
            presentation={modal}
            state={state}
            triggerRef={characterTrigger}
          />
        );
      case "chat":
        return <ChatSocialPanel conversations={conversations} presentation={modal} />;
      default:
        return null;
    }
  }

  // Desktop: wait for the saved home before mounting anything. An accepted
  // trade takes the screen with its own modal; while it does, the passive home
  // is not left mounted — and reading — underneath it.
  const active = dockedUtility(openUtilityId, home);
  if (!active || !home || trade?.session) return null;

  const readyCount = state.missions.filter(
    (mission) => mission.state === "ready_for_completion",
  ).length;

  function select(utility: PlayUtilityId) {
    const intent = openIntentForTab(utility, home);
    if (intent) openUtilityPanel(intent);
    else closeUtilityPanel();
  }

  const homeLabel = PLAY_UTILITY_LABELS[home];
  const actions =
    active === home ? undefined : (
      <div className="flex flex-wrap items-center gap-2 pb-2" data-utility-home-actions="">
        <ActionButton
          className="min-h-9 px-3 py-1 text-xs"
          data-utility-set-default=""
          intent="secondary"
          onClick={() => {
            setHome(active);
            closeUtilityPanel();
            // The button is about to disappear; keep focus in the rail.
            tabRefs[active].current?.focus();
          }}
        >
          Set as default
        </ActionButton>
        <ActionButton
          className="min-h-9 px-3 py-1 text-xs"
          data-utility-return-home=""
          intent="secondary"
          onClick={() => {
            closeUtilityPanel();
            tabRefs[home].current?.focus();
          }}
        >
          Back to {homeLabel}
        </ActionButton>
      </div>
    );
  const docked: DockedUtilityRegion = { id: PANEL_ID, labelledBy: tabId(active), actions };
  const docking: UtilityPresentation = "docked";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-utility-workspace="" ref={railRef}>
      <UtilityTabs
        active={active}
        attentionCount={attentionCount}
        onSelect={select}
        readyCount={readyCount}
        realtimeStatus={status}
        tabRefs={tabRefs}
      />
      {active === "inventory" ? (
        <InventoryEquipmentPanel
          docked={docked}
          onClose={() => closeUtilityPanel("inventory")}
          presentation={docking}
          state={state}
          triggerRef={inventoryTrigger}
        />
      ) : active === "missions" ? (
        <MissionLogPanel
          docked={docked}
          focusedMissionId={missionsFocus}
          onClose={() => closeUtilityPanel("missions")}
          presentation={docking}
          state={state}
          triggerRef={missionsTrigger}
        />
      ) : active === "character" ? (
        <CharacterPanel
          characterName={characterName}
          docked={docked}
          onClose={() => closeUtilityPanel("character")}
          portrait={characterPortrait}
          presentation={docking}
          state={state}
          triggerRef={characterTrigger}
        />
      ) : (
        <ChatSocialPanel conversations={conversations} docked={docked} presentation={docking} />
      )}
    </div>
  );
}
