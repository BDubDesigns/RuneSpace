import { z } from "zod";

/**
 * System recipe-unlock notice contracts (issue #274), shared by
 * `server/system-notices.ts`, its route and action, and the browser.
 *
 * System is RuneSpace speaking, not a player: a notice has no sender
 * character, account, or profile, and nothing here can be replied to,
 * blocked, or reported. Requests name only the active character.
 */

export const SystemNoticesQuerySchema = z.object({
  characterId: z.string().uuid(),
});

export const MarkSystemNoticesReadRequestSchema = z.object({
  characterId: z.string().uuid(),
  /** The newest notice `seq` this tab has shown; later notices stay unread. */
  throughSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/** One read-only System notice, already rendered for display. */
export type SystemNoticeView = {
  id: string;
  seq: number;
  body: string;
  sentAt: string;
};

/** The active character's System conversation. */
export type SystemNoticeInbox = {
  /** The newest notices, oldest first. */
  notices: SystemNoticeView[];
  /** Notices the character has not read yet. */
  unread: number;
};

// Register System deliveries on the shared realtime registry (#245).
declare module "@/game/schemas/realtime" {
  interface RealtimeEventMap {
    /**
     * A notice committed for this character. An invalidation only: the
     * browser re-reads the System conversation.
     */
    "system.notice": Record<string, never>;
    /** The character read System on some tab; its other tabs re-read unread. */
    "system.read": Record<string, never>;
  }
}
