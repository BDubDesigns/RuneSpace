import { and, count, desc, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { recipeUnlockNotices, type RecipeUnlockNotice } from "@/db/rune-space";
import { getMission } from "@/game/content/missions";
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
 * active character's recipe-unlock notices (and, #501, a completed Mission's
 * authored notice) and their durable read state.
 *
 * Notices are written only by `grantCharacterSkillXp` (`server/progression.ts`) and,
 * for an automatically completed Mission, `commitRepairCompletion`.
 * Every entry here re-runs `requirePlayableOwnedCharacter`, so a character only
 * ever reads its own notices. A notice stores which recipes unlocked; their
 * names are rendered here from current item presentation, never stored.
 */

function itemName(itemId: string): string {
  return resolveItemPresentation(itemId, itemId).displayName;
}

function toView(row: RecipeUnlockNotice): SystemNoticeView {
  if (row.kind === "mission_completion") {
    // Authored beside the Mission (#501); only its ID is stored. A row whose Mission
    // no longer authors a notice reads as its title alone rather than disappearing,
    // so the unread count and the list can never disagree.
    const mission = row.missionId ? getMission(row.missionId) : undefined;
    const notice = mission?.completionSystemNotice;
    return {
      id: row.id,
      seq: row.seq,
      body: notice ? `${notice.title}\n${notice.body}` : (mission?.title ?? "Mission complete"),
      sentAt: row.createdAt.toISOString(),
    };
  }
  const skillId = row.skillId ?? "";
  const recipes = skillRecipes(skillId);
  const recipeNames = (row.recipeActionIds ?? []).flatMap((actionId) => {
    const recipe = recipes.find((candidate) => candidate.actionId === actionId);
    return recipe ? [recipeUnlockName(recipe, recipes, itemName)] : [];
  });
  return {
    id: row.id,
    seq: row.seq,
    body: recipeUnlockNoticeBody({
      skillName: getSkillPresentation(skillId)?.displayName ?? skillId,
      level: row.level ?? 0,
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
