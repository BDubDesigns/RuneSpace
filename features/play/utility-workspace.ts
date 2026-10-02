/**
 * The Play utility workspace's pure rules (#286): which utilities exist, how a
 * desktop "home" preference is stored and read back, and what a keyboard press
 * does inside the utility tab list. Nothing here touches React or the DOM, so
 * the rules are unit-tested directly; the hooks that bind them to a browser
 * live beside this file.
 *
 * Presentation only. A utility being open, docked or the home never changes
 * what a server command may do.
 */

/** Chat/Social, Inventory/Equipment, Character and the Mission Log. */
export const PLAY_UTILITY_IDS = ["chat", "inventory", "character", "missions"] as const;

export type PlayUtilityId = (typeof PLAY_UTILITY_IDS)[number];

/** The player-facing tab labels. Missions is never called "Quests". */
export const PLAY_UTILITY_LABELS: Record<PlayUtilityId, string> = {
  chat: "Chat",
  inventory: "Inventory",
  character: "Character",
  missions: "Missions",
};

/** The home a character has until they explicitly choose another. */
export const DEFAULT_HOME_UTILITY: PlayUtilityId = "chat";

export function isPlayUtilityId(value: unknown): value is PlayUtilityId {
  return typeof value === "string" && (PLAY_UTILITY_IDS as readonly string[]).includes(value);
}

/**
 * The desktop dock appears at exactly the width Tailwind's `xl` variant starts
 * (1280px), which is what the shell's CSS uses to place the rail. A unit test
 * pins the two together so layout and presentation can never disagree.
 */
export const DESKTOP_WORKSPACE_MIN_WIDTH_PX = 1280;
export const DESKTOP_WORKSPACE_QUERY = `(min-width: ${DESKTOP_WORKSPACE_MIN_WIDTH_PX}px)`;

const HOME_STORAGE_PREFIX = "runespace:play-home-utility:";

/** The per-character, per-browser key. Presentation only; never sent anywhere. */
export function homeUtilityStorageKey(characterId: string): string {
  return `${HOME_STORAGE_PREFIX}${characterId}`;
}

/** Anything missing, stale or unrecognised falls back to Chat. */
export function parseHomeUtility(raw: string | null | undefined): PlayUtilityId {
  return isPlayUtilityId(raw) ? raw : DEFAULT_HOME_UTILITY;
}

/**
 * Which utility the desktop dock shows: the explicitly chosen one, otherwise
 * the home. `undefined` while the home preference has not been read yet, so the
 * dock can wait rather than mount a default Chat that would be replaced a
 * moment later (a mounted Chat reads messages).
 */
export function dockedUtility(
  open: PlayUtilityId | undefined,
  home: PlayUtilityId | undefined,
): PlayUtilityId | undefined {
  return open ?? home;
}

/**
 * The logical open intent a tab press produces. Choosing the home utility is
 * returning to the passive home rather than an explicit open, so shrinking to a
 * phone afterwards does not raise a modal the player never asked for.
 */
export function openIntentForTab(
  chosen: PlayUtilityId,
  home: PlayUtilityId | undefined,
): PlayUtilityId | undefined {
  return chosen === home ? undefined : chosen;
}

/**
 * Roving-tabindex keyboard handling for the utility tab list: Left/Right wrap,
 * Home/End jump. Returns the tab that should take focus, or `undefined` when
 * the key is not one the list handles.
 */
export function nextUtilityTab(
  current: PlayUtilityId,
  key: string,
  order: readonly PlayUtilityId[] = PLAY_UTILITY_IDS,
): PlayUtilityId | undefined {
  const index = order.indexOf(current);
  if (index === -1) return undefined;
  if (key === "ArrowRight") return order[(index + 1) % order.length];
  if (key === "ArrowLeft") return order[(index - 1 + order.length) % order.length];
  if (key === "Home") return order[0];
  if (key === "End") return order[order.length - 1];
  return undefined;
}
