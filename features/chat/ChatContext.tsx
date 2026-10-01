"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { GAMEPLAY_ACCESS_REQUIRED_CODE } from "@/game/domain/gameplay-access";
import type { ChatMentionsView } from "@/game/schemas/chat";
import type { SanctionNoticeView, SanctionNoticesView } from "@/game/schemas/moderation";
import type { SystemNoticeInbox } from "@/game/schemas/system-notices";
import type { CharacterTarget, WhisperInbox, WhisperPeer } from "@/game/schemas/whispers";
import { isSocialRestriction } from "@/features/moderation/notice-format";
import {
  acknowledgeNotices,
  noticeAcknowledgementKey,
  readAcknowledgedNotices,
} from "@/features/moderation/notice-acknowledgement";
import { SocialNoticeCard } from "@/features/moderation/SocialNoticeCard";
import { useSocial } from "@/features/social/SocialContext";
import { openWhisperAction } from "@/server/actions";

/**
 * Chat state that outlives the Chat/Social Drawer (issue #247). The Drawer
 * unmounts when closed, so this provider — mounted for the whole Play tab —
 * keeps what must stay live while it is closed:
 *
 * - the Drawer's current view (channel tab, open Whisper conversation, or the
 *   Blocked Players list), so a character-facing surface can open a Whisper
 *   inside Chat/Social without navigating;
 * - the active character's durable Whisper inbox, re-read on connect,
 *   reconnect, tab resume, each Whisper delivery, and each read on another
 *   tab, whose unread total feeds the launcher's attention state;
 * - the active character's read-only System conversation (#274), its
 *   recipe-unlock notices, re-read the same way on `"system.notice"` and
 *   `"system.read"`; its unread count is a second attention source;
 * - the active character's unread public `@mentions` (#261), re-read the same
 *   way on `"chat.mention"`, `"chat.mentions.read"`, and Block changes (a Block
 *   silences mentions); per channel they badge General and Trade, and their
 *   total is a third attention source;
 * - a Block revision that every chat view re-reads on, bumped by this tab's
 *   Block actions and by `"safety.blocks"` from the account's other tabs;
 * - the account's current moderation notices (#248), re-read on mount,
 *   reconnect, tab resume, and `"moderation.notices"`. Each current notice is
 *   a pinned social card that lights the launcher only until the panel has
 *   shown it on this device, and a current social restriction tells the
 *   composers to hold Send (presentation only; the server refuses the send).
 *
 * Every number here mirrors server state; nothing is authority.
 */

export type ChatTab = "general" | "trade" | "whispers";

export type ChatView =
  | { tab: "general" | "trade" }
  | {
      tab: "whispers";
      peer?: WhisperPeer;
      blockedPlayers?: boolean;
      system?: boolean;
      /** The conversation just hidden (#261), named once on the list. */
      hiddenName?: string;
    };

type ChatContextValue = {
  characterId: string;
  view: ChatView;
  setView: (view: ChatView) => void;
  inbox: WhisperInbox | undefined;
  refreshInbox: () => void;
  /** The read-only System conversation (#274). */
  system: SystemNoticeInbox | undefined;
  refreshSystem: () => void;
  /** Unread Whispers plus unread System notices: the Whispers tab's badge. */
  whispersTabUnread: number;
  /** Unread public `@mentions` per channel and in total (#261). */
  mentions: ChatMentionsView | undefined;
  refreshMentions: () => void;
  blocksRevision: number;
  /** A Block or Unblock committed on this tab. */
  blocksChanged: () => void;
  /** A social restriction is in effect: composers hold Send (the server enforces). */
  socialRestricted: boolean;
  /** Re-read the account's moderation notices (for example after a refused send). */
  refreshNotices: () => void;
  /**
   * Open a Whisper with a character inside Chat/Social. Resolves with a
   * player-facing error when that character cannot be whispered.
   */
  startWhisper: (target: CharacterTarget) => Promise<string | undefined>;
};

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

/** Attention source key for unread Whispers on the Chat/Social launcher. */
const WHISPER_ATTENTION = "whispers";
/** Attention source key for unread System notices (#274). */
const SYSTEM_ATTENTION = "system";
/** Attention source key for unread public mentions (#261). */
const MENTION_ATTENTION = "mentions";

const NOTICE_CARD_PREFIX = "moderation-notice:";

async function fetchNotices(): Promise<SanctionNoticeView[] | undefined> {
  try {
    const response = await fetch("/api/moderation-notices", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return undefined;
    const body = (await response.json().catch(() => null)) as SanctionNoticesView | null;
    return Array.isArray(body?.notices) ? body.notices : undefined;
  } catch {
    return undefined;
  }
}

async function fetchInbox(
  characterId: string,
): Promise<{ inbox: WhisperInbox } | { error: string; code?: string }> {
  try {
    const response = await fetch(`/api/whispers?${new URLSearchParams({ characterId })}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as
      | (WhisperInbox & { error?: undefined })
      | { error?: string; code?: string }
      | null;
    if (!response.ok || !body || "error" in body) {
      const refusal = body as { error?: string; code?: string } | null;
      return { error: refusal?.error ?? "Whispers could not be loaded.", code: refusal?.code };
    }
    return { inbox: body as WhisperInbox };
  } catch {
    return { error: "Whispers could not be loaded." };
  }
}

async function fetchSystem(
  characterId: string,
): Promise<{ system: SystemNoticeInbox } | { error: string; code?: string }> {
  try {
    const response = await fetch(`/api/system-notices?${new URLSearchParams({ characterId })}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as
      | (SystemNoticeInbox & { error?: undefined })
      | { error?: string; code?: string }
      | null;
    if (!response.ok || !body || "error" in body) {
      const refusal = body as { error?: string; code?: string } | null;
      return {
        error: refusal?.error ?? "System messages could not be loaded.",
        code: refusal?.code,
      };
    }
    return { system: body as SystemNoticeInbox };
  } catch {
    return { error: "System messages could not be loaded." };
  }
}

async function fetchMentions(
  characterId: string,
): Promise<{ mentions: ChatMentionsView } | { error: string; code?: string }> {
  try {
    const response = await fetch(`/api/chat/mentions?${new URLSearchParams({ characterId })}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as
      | (ChatMentionsView & { error?: undefined })
      | { error?: string; code?: string }
      | null;
    if (!response.ok || !body || "error" in body) {
      const refusal = body as { error?: string; code?: string } | null;
      return { error: refusal?.error ?? "Mentions could not be loaded.", code: refusal?.code };
    }
    return { mentions: body as ChatMentionsView };
  } catch {
    return { error: "Mentions could not be loaded." };
  }
}

export function ChatProvider({
  characterId,
  children,
}: {
  characterId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const { open, openSocial, onReconcile, removeCard, setAttention, subscribe, upsertCard } =
    useSocial();
  const [view, setView] = useState<ChatView>({ tab: "general" });
  const [inbox, setInbox] = useState<WhisperInbox>();
  const [system, setSystem] = useState<SystemNoticeInbox>();
  const [mentions, setMentions] = useState<ChatMentionsView>();
  const [blocksRevision, setBlocksRevision] = useState(0);
  const [notices, setNotices] = useState<SanctionNoticeView[]>([]);
  // Notices this device has already shown in the open panel (#248). Notices
  // are only fetched after mount, so the server render never depends on it.
  const [seenNotices, setSeenNotices] = useState<ReadonlySet<string>>(() =>
    typeof window === "undefined" ? new Set() : readAcknowledgedNotices(),
  );
  // Inbox answers can arrive out of order; only the newest request applies.
  const requestCounter = useRef(0);
  const systemRequestCounter = useRef(0);
  const mentionRequestCounter = useRef(0);
  const noticeRequestCounter = useRef(0);
  // The shell's card setters change identity with its state; read them through
  // refs so a card update never re-runs the effect that produced it.
  const cardsRef = useRef({ upsertCard, removeCard });
  cardsRef.current = { upsertCard, removeCard };
  const noticeCardKeys = useRef(new Set<string>());

  const refreshInbox = useCallback(() => {
    const request = ++requestCounter.current;
    void fetchInbox(characterId).then((result) => {
      if (request !== requestCounter.current) return;
      if ("error" in result) {
        if (result.code === GAMEPLAY_ACCESS_REQUIRED_CODE) routerRef.current.replace("/characters");
        return;
      }
      setInbox(result.inbox);
    });
  }, [characterId]);

  useEffect(() => {
    refreshInbox();
  }, [refreshInbox]);

  const refreshSystem = useCallback(() => {
    const request = ++systemRequestCounter.current;
    void fetchSystem(characterId).then((result) => {
      if (request !== systemRequestCounter.current) return;
      if ("error" in result) {
        if (result.code === GAMEPLAY_ACCESS_REQUIRED_CODE) routerRef.current.replace("/characters");
        return;
      }
      setSystem(result.system);
    });
  }, [characterId]);

  useEffect(() => {
    refreshSystem();
  }, [refreshSystem]);

  const refreshMentions = useCallback(() => {
    const request = ++mentionRequestCounter.current;
    void fetchMentions(characterId).then((result) => {
      if (request !== mentionRequestCounter.current) return;
      if ("error" in result) {
        if (result.code === GAMEPLAY_ACCESS_REQUIRED_CODE) routerRef.current.replace("/characters");
        return;
      }
      setMentions(result.mentions);
    });
  }, [characterId]);

  useEffect(() => {
    refreshMentions();
  }, [refreshMentions]);

  const refreshNotices = useCallback(() => {
    const request = ++noticeRequestCounter.current;
    void fetchNotices().then((next) => {
      // A failed read leaves what is shown; only the newest answer applies.
      if (next && request === noticeRequestCounter.current) setNotices(next);
    });
  }, []);

  useEffect(() => {
    refreshNotices();
  }, [refreshNotices]);

  useEffect(() => {
    const { upsertCard: upsert, removeCard: remove } = cardsRef.current;
    const keys = new Set<string>();
    for (const notice of notices) {
      if (!notice.current) continue;
      const key = `${NOTICE_CARD_PREFIX}${notice.sanctionId}`;
      keys.add(key);
      upsert({
        key,
        label: "Moderation notice",
        content: <SocialNoticeCard notice={notice} />,
        // Pinned while current; lights the launcher only until it is seen.
        attention: !seenNotices.has(noticeAcknowledgementKey(notice)),
      });
    }
    for (const key of noticeCardKeys.current) if (!keys.has(key)) remove(key);
    noticeCardKeys.current = keys;
  }, [notices, seenNotices]);

  // Opening Chat/Social presents every current notice at the top of the
  // panel, so each one has now been seen on this device. Whisper unread is a
  // separate source and is untouched.
  useEffect(() => {
    if (!open) return;
    const unseen = notices
      .filter((notice) => notice.current)
      .map(noticeAcknowledgementKey)
      .filter((key) => !seenNotices.has(key));
    if (unseen.length > 0) setSeenNotices(acknowledgeNotices(seenNotices, unseen));
  }, [notices, open, seenNotices]);

  useEffect(
    () =>
      onReconcile(() => {
        refreshInbox();
        refreshSystem();
        refreshMentions();
        refreshNotices();
      }),
    [onReconcile, refreshInbox, refreshMentions, refreshNotices, refreshSystem],
  );
  useEffect(
    () => subscribe("moderation.notices", () => refreshNotices()),
    [refreshNotices, subscribe],
  );
  useEffect(() => subscribe("whisper.message", () => refreshInbox()), [refreshInbox, subscribe]);
  useEffect(() => subscribe("whisper.read", () => refreshInbox()), [refreshInbox, subscribe]);
  useEffect(() => subscribe("system.notice", () => refreshSystem()), [refreshSystem, subscribe]);
  useEffect(() => subscribe("system.read", () => refreshSystem()), [refreshSystem, subscribe]);
  useEffect(() => subscribe("chat.mention", () => refreshMentions()), [refreshMentions, subscribe]);
  useEffect(
    () => subscribe("chat.mentions.read", () => refreshMentions()),
    [refreshMentions, subscribe],
  );
  useEffect(
    () =>
      subscribe("safety.blocks", () => {
        setBlocksRevision((revision) => revision + 1);
        refreshInbox();
        refreshMentions();
      }),
    [refreshInbox, refreshMentions, subscribe],
  );

  const socialRestricted = notices.some(isSocialRestriction);
  const unreadTotal = inbox?.unreadTotal ?? 0;
  useEffect(() => {
    setAttention(WHISPER_ATTENTION, unreadTotal);
  }, [setAttention, unreadTotal]);
  const systemUnread = system?.unread ?? 0;
  useEffect(() => {
    setAttention(SYSTEM_ATTENTION, systemUnread);
  }, [setAttention, systemUnread]);
  const whispersTabUnread = unreadTotal + systemUnread;
  const mentionUnread = mentions?.unreadTotal ?? 0;
  useEffect(() => {
    setAttention(MENTION_ATTENTION, mentionUnread);
  }, [mentionUnread, setAttention]);

  const blocksChanged = useCallback(() => {
    setBlocksRevision((revision) => revision + 1);
    refreshInbox();
    refreshMentions();
  }, [refreshInbox, refreshMentions]);

  const startWhisper = useCallback(
    async (target: CharacterTarget) => {
      let result: Awaited<ReturnType<typeof openWhisperAction>>;
      try {
        result = await openWhisperAction({ characterId, target });
      } catch {
        return "Whisper could not be opened. Check your connection and try again.";
      }
      if ("error" in result) return result.error;
      setView({ tab: "whispers", peer: result.peer });
      openSocial();
      return undefined;
    },
    [characterId, openSocial],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      characterId,
      view,
      setView,
      inbox,
      refreshInbox,
      system,
      refreshSystem,
      whispersTabUnread,
      mentions,
      refreshMentions,
      blocksRevision,
      blocksChanged,
      socialRestricted,
      refreshNotices,
      startWhisper,
    }),
    [
      blocksChanged,
      blocksRevision,
      characterId,
      inbox,
      mentions,
      refreshInbox,
      refreshMentions,
      refreshNotices,
      refreshSystem,
      socialRestricted,
      startWhisper,
      system,
      view,
      whispersTabUnread,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("Chat is unavailable");
  return context;
}
