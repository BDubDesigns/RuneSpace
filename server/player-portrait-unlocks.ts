import { eq } from "drizzle-orm";
import { db } from "@/db";
import { playerPortraitUnlocks, type PlayerPortraitUnlock } from "@/db/rune-space";
import {
  getSelectablePortraitOptions,
  isSelectablePortrait,
  type SelectablePortraitOption,
} from "@/game/domain/character-portrait";
import { isPlayerUnlockablePortrait } from "@/game/content/portrait-catalog";

/** Stable grant origins currently approved by the product boundary. */
export const PLAYER_PORTRAIT_UNLOCK_SOURCES = ["operator"] as const;
export type PlayerPortraitUnlockSource = (typeof PLAYER_PORTRAIT_UNLOCK_SOURCES)[number];

export class PlayerPortraitUnlockError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "PlayerPortraitUnlockError";
  }
}

/** Load only stable portrait IDs owned by one RuneSpace player account. */
export async function loadPlayerPortraitUnlockIds(
  playerAccountId: string,
): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ portraitId: playerPortraitUnlocks.portraitId })
    .from(playerPortraitUnlocks)
    .where(eq(playerPortraitUnlocks.playerAccountId, playerAccountId));
  return new Set(rows.map((row) => row.portraitId));
}

/** Project the account's complete selectable portrait set for server-rendered UI. */
export async function getPlayerSelectablePortraitOptions(
  playerAccountId: string,
): Promise<readonly SelectablePortraitOption[]> {
  return getSelectablePortraitOptions(await loadPlayerPortraitUnlockIds(playerAccountId));
}

/** Shared server-side selection check used by character creation and edits. */
export async function isPortraitSelectableForPlayer(
  playerAccountId: string,
  portraitId: string,
): Promise<boolean> {
  return isSelectablePortrait(portraitId, await loadPlayerPortraitUnlockIds(playerAccountId));
}

/**
 * Idempotently grant an explicitly approved player-unlockable portrait.
 *
 * The composite primary key makes repeated delivery converge to one row. The
 * return value distinguishes a first grant from a replay without exposing any
 * account data to callers that only need to drive a future reward boundary.
 */
export async function grantPlayerPortraitUnlock(
  playerAccountId: string,
  portraitId: string,
  source: PlayerPortraitUnlockSource,
): Promise<{ unlock: PlayerPortraitUnlock; created: boolean }> {
  if (!isPlayerUnlockablePortrait(portraitId)) {
    throw new PlayerPortraitUnlockError("That portrait is not approved for player unlocks", 400);
  }
  if (!PLAYER_PORTRAIT_UNLOCK_SOURCES.includes(source)) {
    throw new PlayerPortraitUnlockError("That portrait unlock source is not approved", 400);
  }

  const inserted = await db
    .insert(playerPortraitUnlocks)
    .values({ playerAccountId, portraitId, source })
    .onConflictDoNothing({
      target: [playerPortraitUnlocks.playerAccountId, playerPortraitUnlocks.portraitId],
    })
    .returning();
  if (inserted[0]) return { unlock: inserted[0], created: true };

  const existing = await db
    .select()
    .from(playerPortraitUnlocks)
    .where(eq(playerPortraitUnlocks.playerAccountId, playerAccountId))
    .then((rows) => rows.find((row) => row.portraitId === portraitId));
  if (!existing) {
    throw new PlayerPortraitUnlockError("Portrait unlock could not be resolved", 500);
  }
  return { unlock: existing, created: false };
}
