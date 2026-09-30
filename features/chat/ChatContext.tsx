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
import type { CharacterTarget, WhisperInbox, WhisperPeer } from "@/game/schemas/whispers";
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
 * - a Block revision that every chat view re-reads on, bumped by this tab's
 *   Block actions and by `"safety.blocks"` from the account's other tabs.
 *
 * Every number here mirrors server state; nothing is authority.
 */

export type ChatTab = "general" | "trade" | "whispers";

export type ChatView =
  | { tab: "general" | "trade" }
  | { tab: "whispers"; peer?: WhisperPeer; blockedPlayers?: boolean };

type ChatContextValue = {
  characterId: string;
  view: ChatView;
  setView: (view: ChatView) => void;
  inbox: WhisperInbox | undefined;
  refreshInbox: () => void;
  blocksRevision: number;
  /** A Block or Unblock committed on this tab. */
  blocksChanged: () => void;
  /**
   * Open a Whisper with a character inside Chat/Social. Resolves with a
   * player-facing error when that character cannot be whispered.
   */
  startWhisper: (target: CharacterTarget) => Promise<string | undefined>;
};

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

/** Attention source key for unread Whispers on the Chat/Social launcher. */
const WHISPER_ATTENTION = "whispers";

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
  const { openSocial, onReconcile, setAttention, subscribe } = useSocial();
  const [view, setView] = useState<ChatView>({ tab: "general" });
  const [inbox, setInbox] = useState<WhisperInbox>();
  const [blocksRevision, setBlocksRevision] = useState(0);
  // Inbox answers can arrive out of order; only the newest request applies.
  const requestCounter = useRef(0);

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

  useEffect(() => onReconcile(() => refreshInbox()), [onReconcile, refreshInbox]);
  useEffect(() => subscribe("whisper.message", () => refreshInbox()), [refreshInbox, subscribe]);
  useEffect(() => subscribe("whisper.read", () => refreshInbox()), [refreshInbox, subscribe]);
  useEffect(
    () =>
      subscribe("safety.blocks", () => {
        setBlocksRevision((revision) => revision + 1);
        refreshInbox();
      }),
    [refreshInbox, subscribe],
  );

  const unreadTotal = inbox?.unreadTotal ?? 0;
  useEffect(() => {
    setAttention(WHISPER_ATTENTION, unreadTotal);
  }, [setAttention, unreadTotal]);

  const blocksChanged = useCallback(() => {
    setBlocksRevision((revision) => revision + 1);
    refreshInbox();
  }, [refreshInbox]);

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
      blocksRevision,
      blocksChanged,
      startWhisper,
    }),
    [blocksChanged, blocksRevision, characterId, inbox, refreshInbox, startWhisper, view],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("Chat is unavailable");
  return context;
}
