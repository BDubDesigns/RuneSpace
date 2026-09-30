"use client";

import type { ChatChannel } from "@/game/domain/chat";
import { useChat, type ChatTab } from "./ChatContext";
import { PublicChat } from "./PublicChat";
import { WhisperPanel } from "./WhisperPanel";

const TAB_LABEL: Record<ChatTab, string> = {
  general: "General",
  trade: "Trade",
  whispers: "Whispers",
};

/**
 * The Chat/Social conversation region: General, Trade (issue #246), and
 * Whispers (#247) as three tabs. The selected tab lives in `ChatContext`, so
 * closing and reopening the Drawer — or a character-facing surface opening a
 * Whisper — lands on the right view. Unread Whispers show on their tab as
 * well as on the launcher.
 */
export function ChatConversations({ characterId }: { characterId: string }) {
  const { inbox, setView, view } = useChat();
  const unread = inbox?.unreadTotal ?? 0;
  return (
    <div className="space-y-3">
      <div
        aria-label="Chat channels"
        className="grid grid-cols-3 gap-1 border-b border-[color:var(--rs-border-structural)] pb-1"
        role="tablist"
      >
        {(["general", "trade", "whispers"] as const).map((option) => {
          const selected = option === view.tab;
          const badge = option === "whispers" && unread > 0;
          return (
            <button
              aria-controls="chat-panel"
              aria-label={badge ? `${TAB_LABEL[option]}, ${unread} unread` : undefined}
              aria-selected={selected}
              className={`rs-focus relative min-h-[var(--rs-touch-target)] border px-2 py-2 font-display text-xs uppercase tracking-[0.12em] outline-none ${selected ? "border-[color:var(--rs-accent-primary)] text-[color:var(--rs-accent-primary)]" : "border-[color:var(--rs-border-structural)] text-[color:var(--rs-text-secondary)]"}`}
              data-chat-channel-tab={option}
              id={`chat-tab-${option}`}
              key={option}
              onClick={() => {
                // Re-selecting Whispers returns to its conversation list.
                setView({ tab: option });
              }}
              role="tab"
              type="button"
            >
              {TAB_LABEL[option]}
              {badge ? (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full border border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-surface-control)] px-0.5 text-[9px] font-bold leading-none text-[color:var(--rs-accent-primary)] [box-shadow:var(--rs-glow-news-unread)]"
                  data-whisper-unread-total={unread}
                >
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div aria-labelledby={`chat-tab-${view.tab}`} id="chat-panel" role="tabpanel">
        {view.tab === "whispers" ? (
          <WhisperPanel />
        ) : (
          <PublicChat channel={view.tab as ChatChannel} characterId={characterId} />
        )}
      </div>
    </div>
  );
}
