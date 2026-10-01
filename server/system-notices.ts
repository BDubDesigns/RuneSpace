import { and, count, desc, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { recipeUnlockNotices, type RecipeUnlockNotice } from "@/db/rune-space";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import { CHAT_POLICY } from "@/game/domain/chat";
import {
  recipeUnlockName,
  recipeUnlockNoticeBody,
  skillRecipes,
} from "@/game/domain/recipe-unlocks";
import type { SystemNoticeInbox, SystemNoticeView } from "@/game/schemas/system-notices";
import { requirePlayableOwnedCharacter } from "@/server/gameplay-access";
import { publishRealtimeEvent } from "@/server/realtime";

/**
 * The read side of the Chat/Social System conversation (issue #274): the
 * active character's recipe-unlock notices and their durable read state.
 *
 * Notices are written only by `grantCharacterSkillXp` (`server/progression.ts`).
 * Every entry here re-runs `requirePlayableOwnedCharacter`, so a character only
 * ever reads its own notices. A notice stores which recipes unlocked; their
 * names are rendered here from current item presentation, never stored.
 */

function itemName(itemId: string): string {
  return resolveItemPresentation(itemId, itemId).displayName;
}

function toView(row: RecipeUnlockNotice): SystemNoticeView {
  const recipes = skillRecipes(row.skillId);
  const recipeNames = row.recipeActionIds.flatMap((actionId) => {
    const recipe = recipes.find((candidate) => candidate.actionId === actionId);
    return recipe ? [recipeUnlockName(recipe, recipes, itemName)] : [];
  });
  return {
    id: row.id,
    seq: row.seq,
    body: recipeUnlockNoticeBody({
      skillName: getSkillPresentation(row.skillId)?.displayName ?? row.skillId,
      level: row.level,
      recipeNames,
    }),
    sentAt: row.createdAt.toISOString(),
  };
}

/** The active character's newest System notices, oldest first, and its unread count. */
export async function readSystemNotices(
  userId: string,
  characterId: string,
): Promise<SystemNoticeInbox> {
  const me = await requirePlayableOwnedCharacter(userId, characterId);
  const [rows, [unread]] = await Promise.all([
    db
      .select()
      .from(recipeUnlockNotices)
      .where(eq(recipeUnlockNotices.characterId, me.id))
      .orderBy(desc(recipeUnlockNotices.seq))
      .limit(CHAT_POLICY.pageSize),
    db
      .select({ unread: count() })
      .from(recipeUnlockNotices)
      .where(and(eq(recipeUnlockNotices.characterId, me.id), isNull(recipeUnlockNotices.readAt))),
  ]);
  return { notices: rows.reverse().map(toView), unread: unread?.unread ?? 0 };
}

/**
 * Mark the active character's notices read through `throughSeq`. A notice is
 * read once and stays read, on every tab and device: its other tabs are told
 * to re-read. A notice newer than what this tab showed stays unread.
 */
export async function markSystemNoticesRead(
  userId: string,
  characterId: string,
  request: { throughSeq: number },
  now: Date = new Date(),
): Promise<{ status: "read" }> {
  const me = await requirePlayableOwnedCharacter(userId, characterId);
  const marked = await db
    .update(recipeUnlockNotices)
    .set({ readAt: now })
    .where(
      and(
        eq(recipeUnlockNotices.characterId, me.id),
        lte(recipeUnlockNotices.seq, request.throughSeq),
        isNull(recipeUnlockNotices.readAt),
      ),
    )
    .returning({ id: recipeUnlockNotices.id });
  if (marked.length > 0) {
    publishRealtimeEvent({ kind: "character", characterId: me.id }, "system.read", {});
  }
  return { status: "read" };
}
