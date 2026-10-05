import { chatMessages, type ChatMessage } from "@/db/rune-space";
import type { SystemChatMessageView } from "@/game/schemas/chat";
import { afterCharacterCommandCommits, type DatabaseTransaction } from "@/server/action-resolution";
import { publishRealtimeEvent } from "@/server/realtime";

/**
 * Public System messages (#308): automatic lines RuneSpace itself posts to the
 * General timeline, today only a Mining RARE FIND announcement.
 *
 * They are rows in the one durable `chat_messages` timeline, so history, paging,
 * retention, and live delivery are the ordinary chat paths. What makes them
 * System is what they lack: no sender account, character, or name (this is not
 * a player and never pretends to be one), no send budget (nothing here reads or
 * spends a player's rate window), no mentions, and no Whisper / Report / Block
 * surface. The chat table's check constraint makes that a database fact, not a
 * convention.
 */

/** A System row as the wire carries it. */
export function toSystemView(row: ChatMessage): SystemChatMessageView {
  return {
    redacted: false,
    system: true,
    id: row.id,
    seq: row.seq,
    channel: "general",
    promoted: false,
    treatment: "rare_find",
    body: row.body,
    sentAt: row.createdAt.toISOString(),
  };
}

/** The announcement's copy: the character's name, never the account's. */
export function rareFindAnnouncementBody(input: {
  characterName: string;
  itemName: string;
  locationName: string;
}): string {
  return `${input.characterName} just found ${input.itemName} at ${input.locationName}!`;
}

/**
 * Record one RARE FIND announcement inside the caller's transaction, so it
 * commits together with the item, the XP, and the run history it announces — or
 * not at all. Live delivery is queued for after that commit; a rollback drops
 * it, and a missed delivery is recovered by the ordinary history read.
 */
export async function recordRareFindAnnouncement(
  transaction: DatabaseTransaction,
  input: { characterName: string; itemName: string; locationName: string; now: Date },
): Promise<SystemChatMessageView> {
  const [row] = await transaction
    .insert(chatMessages)
    .values({
      kind: "rare_find",
      channel: "general",
      body: rareFindAnnouncementBody(input),
      createdAt: input.now,
    })
    .returning();
  const view = toSystemView(row!);
  afterCharacterCommandCommits(transaction, () => {
    publishRealtimeEvent({ kind: "everyone" }, "chat.message", view);
  });
  return view;
}
