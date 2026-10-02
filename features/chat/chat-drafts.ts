import type { MentionCandidate } from "./mention-draft";

/**
 * Unsent Chat text that outlives the Chat surface (#286). The surface
 * unmounts whenever another desktop utility is selected, a phone's Drawer
 * closes, or the viewport crosses the dock breakpoint; the draft must not go
 * with it. Unmounting also stops the surface reading messages, which is the
 * point of not simply hiding it.
 *
 * A plain Map owned by `ChatProvider` for the life of the Play page — a ref,
 * not state, so typing never re-renders every Chat consumer. Presentation
 * only; nothing here is persisted or sent until the player presses Send.
 */
export type ChatDraft = {
  text: string;
  /** Mentions chosen from the candidate list for the text above. */
  mentions: MentionCandidate[];
  /** Whether the Trade composer is set to post a promoted ad. */
  promote: boolean;
};

export const EMPTY_CHAT_DRAFT: ChatDraft = { text: "", mentions: [], promote: false };

/** General and Trade share one composer draft, exactly as they did in one mounted view. */
export const PUBLIC_CHAT_DRAFT_KEY = "public";

export function whisperDraftKey(peerCharacterId: string): string {
  return `whisper:${peerCharacterId}`;
}

export type ChatDraftStore = {
  read: (key: string) => ChatDraft;
  write: (key: string, draft: ChatDraft) => void;
};

export function createChatDraftStore(): ChatDraftStore {
  const drafts = new Map<string, ChatDraft>();
  return {
    read: (key) => drafts.get(key) ?? EMPTY_CHAT_DRAFT,
    write: (key, draft) => {
      // An empty draft is the absence of one; keep the Map from filling up.
      if (!draft.text && draft.mentions.length === 0 && !draft.promote) drafts.delete(key);
      else drafts.set(key, draft);
    },
  };
}
