import { and, asc, desc, eq, gt, gte, lt, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  characters,
  chatMessages,
  playerReports,
  whisperParticipants,
  type Character,
  type ChatMessage,
} from "@/db/rune-space";
import { chatRetentionCutoff, type ChatChannel } from "@/game/domain/chat";
import { normalizeReportNote, REPORT_POLICY, type ReportReason } from "@/game/domain/social-safety";
import type { CharacterTarget } from "@/game/schemas/whispers";
import type { ReportResult } from "@/game/schemas/social-safety";
import { channelFeed } from "@/server/chat";
import { requirePlayableOwnedCharacter } from "@/server/gameplay-access";
import { publishBlocksChanged, recordBlock } from "@/server/player-blocks";
import { CHARACTER_TARGET_NOT_FOUND, resolveCharacterTarget } from "@/server/social-targets";

/**
 * Player reports (issue #247): "RuneSpace should review this."
 *
 * A message report is bound to the immutable message id and snapshots the
 * exact message plus up to `REPORT_POLICY.contextBefore`/`contextAfter`
 * neighbours from the same feed — General, Trade, or that one Whisper
 * conversation, never any other — into the report row, so the evidence
 * survives ordinary 90-day retention. A player report names only a character.
 *
 * Reporting never blocks by itself; `alsoBlock` is the combined Report + Block
 * path and commits with the report. The reported player is never told, and a
 * report is a signal for human review (#248), never a score or a sanction.
 */

/** One preserved message, with the stable identities operators need. */
export type ReportedMessageSnapshot = {
  id: string;
  seq: number;
  channel: string;
  conversationId: string | null;
  senderPlayerAccountId: string;
  senderCharacterId: string;
  senderCharacterName: string;
  body: string;
  promoted: boolean;
  sentAt: string;
};

/** The `evidence` of a message report. */
export type MessageReportEvidence = {
  message: ReportedMessageSnapshot;
  /** Oldest first. */
  before: ReportedMessageSnapshot[];
  /** Oldest first. */
  after: ReportedMessageSnapshot[];
};

export type ReportOptions = { now?: Date };

const MESSAGE_NOT_FOUND = "That message can't be reported.";
const NOTE_TOO_LONG = `Notes can be up to ${REPORT_POLICY.noteMaxLength} characters.`;

function snapshot(row: ChatMessage): ReportedMessageSnapshot {
  return {
    id: row.id,
    seq: row.seq,
    channel: row.channel,
    conversationId: row.conversationId,
    senderPlayerAccountId: row.senderPlayerAccountId,
    senderCharacterId: row.senderCharacterId,
    senderCharacterName: row.senderCharacterName,
    body: row.body,
    promoted: row.promotedPriceCredits !== null,
    sentAt: row.createdAt.toISOString(),
  };
}

/**
 * The reported message and its bounded context. Public messages read the feed
 * their channel shows (a promoted ad is a Trade message); a Whisper reads its
 * own conversation only.
 */
async function captureEvidence(row: ChatMessage, now: Date): Promise<MessageReportEvidence> {
  const feed: SQL =
    row.channel === "whisper"
      ? eq(chatMessages.conversationId, row.conversationId!)
      : channelFeed(row.channel as ChatChannel);
  const retained = gte(chatMessages.createdAt, new Date(chatRetentionCutoff(now.getTime())));
  const [before, after] = await Promise.all([
    db
      .select()
      .from(chatMessages)
      .where(and(feed, retained, lt(chatMessages.seq, row.seq)))
      .orderBy(desc(chatMessages.seq))
      .limit(REPORT_POLICY.contextBefore),
    db
      .select()
      .from(chatMessages)
      .where(and(feed, retained, gt(chatMessages.seq, row.seq)))
      .orderBy(asc(chatMessages.seq))
      .limit(REPORT_POLICY.contextAfter),
  ]);
  return {
    message: snapshot(row),
    before: before.reverse().map(snapshot),
    after: after.map(snapshot),
  };
}

/**
 * Store one report, and for Report + Block the Block, in one transaction.
 * A repeat of the same account's report on the same message stores nothing.
 */
async function commitReport(
  reporter: Character,
  reported: Character,
  values: Omit<
    typeof playerReports.$inferInsert,
    | "reporterPlayerAccountId"
    | "reporterCharacterId"
    | "reportedPlayerAccountId"
    | "reportedCharacterId"
    | "reportedCharacterName"
  >,
  alsoBlock: boolean,
  now: Date,
): Promise<ReportResult> {
  const { created, blockCreated } = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(playerReports)
      .values({
        ...values,
        reporterPlayerAccountId: reporter.playerAccountId,
        reporterCharacterId: reporter.id,
        reportedPlayerAccountId: reported.playerAccountId,
        reportedCharacterId: reported.id,
        reportedCharacterName: reported.displayName,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: playerReports.id });
    const blockCreated = alsoBlock ? await recordBlock(tx, reporter, reported, now) : false;
    return { created: inserted.length > 0, blockCreated };
  });
  if (blockCreated) publishBlocksChanged(reporter.playerAccountId);
  return {
    status: created ? "reported" : "duplicate",
    blocked: alsoBlock,
    name: reported.displayName,
  };
}

/** Report one General, Trade, promoted-ad, or Whisper message. */
export async function reportMessage(
  userId: string,
  characterId: string,
  request: { messageId: string; reason: ReportReason; note?: string; alsoBlock?: boolean },
  { now = new Date() }: ReportOptions = {},
): Promise<ReportResult> {
  const reporter = await requirePlayableOwnedCharacter(userId, characterId);
  const note = normalizeReportNote(request.note);
  if (!note.ok) return { error: NOTE_TOO_LONG };

  const [row] = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.id, request.messageId),
        gte(chatMessages.createdAt, new Date(chatRetentionCutoff(now.getTime()))),
      ),
    )
    .limit(1);
  if (!row) return { error: MESSAGE_NOT_FOUND };
  // A Whisper is reportable only by the other participant character.
  if (row.channel === "whisper") {
    const [participant] = await db
      .select({ characterId: whisperParticipants.characterId })
      .from(whisperParticipants)
      .where(
        and(
          eq(whisperParticipants.conversationId, row.conversationId!),
          eq(whisperParticipants.characterId, reporter.id),
        ),
      )
      .limit(1);
    if (!participant) return { error: MESSAGE_NOT_FOUND };
  }
  if (row.senderPlayerAccountId === reporter.playerAccountId) {
    return { error: "You can't report your own messages." };
  }
  const [reported] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, row.senderCharacterId))
    .limit(1);
  if (!reported) return { error: MESSAGE_NOT_FOUND };

  const evidence = await captureEvidence(row, now);
  return commitReport(
    reporter,
    reported,
    {
      kind: "message",
      reason: request.reason,
      note: note.note,
      messageId: row.id,
      channel: row.channel,
      conversationId: row.conversationId,
      evidence,
    },
    request.alsoBlock ?? false,
    now,
  );
}

/** Report a player's behaviour not tied to one message. */
export async function reportPlayer(
  userId: string,
  characterId: string,
  request: { target: CharacterTarget; reason: ReportReason; note?: string; alsoBlock?: boolean },
  { now = new Date() }: ReportOptions = {},
): Promise<ReportResult> {
  const reporter = await requirePlayableOwnedCharacter(userId, characterId);
  const note = normalizeReportNote(request.note);
  if (!note.ok) return { error: NOTE_TOO_LONG };
  const reported = await resolveCharacterTarget(request.target, reporter);
  if (!reported) return { error: CHARACTER_TARGET_NOT_FOUND };
  if (reported.playerAccountId === reporter.playerAccountId) {
    return { error: "You can't report your own characters." };
  }
  return commitReport(
    reporter,
    reported,
    { kind: "player", reason: request.reason, note: note.note },
    request.alsoBlock ?? false,
    now,
  );
}
