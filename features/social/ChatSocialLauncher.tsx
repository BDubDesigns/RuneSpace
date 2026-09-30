"use client";

import { MessagesSquare } from "lucide-react";
import type { Ref } from "react";
import type { RealtimeStatus } from "./realtime-connection";
import { useSocial } from "./SocialContext";

export function chatSocialLauncherLabel(attentionCount: number): string {
  if (attentionCount <= 0) return "Chat";
  return `Chat, ${attentionCount} ${attentionCount === 1 ? "item needs" : "items need"} attention`;
}

/**
 * The compact floating Chat/Social launcher (issue #245): the phone launcher
 * pattern, fixed above the Play footer by `GameShell`'s `floatingAction` slot.
 * It opens the Chat/Social Drawer over whatever the player is doing and never
 * navigates. Presentational: the attention count and open handler come from
 * `SocialContext`, so a later docked desktop presentation does not need it.
 *
 * Attention reuses the News control's unread language — a count badge plus
 * the `--rs-glow-news-unread` halo on the unclipped wrapper (the button's
 * `rs-bevel` clip-path would clip an exterior glow) — and folds the count
 * into the accessible name, since the badge itself is `aria-hidden`. Static,
 * so reduced motion needs no special case.
 */
export function ChatSocialLauncher({
  attentionCount,
  status,
  onOpen,
  ref,
}: {
  attentionCount: number;
  /** Exposed as a data attribute for diagnostics and browser tests only. */
  status: RealtimeStatus;
  onOpen: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const attention = attentionCount > 0;
  return (
    <div
      className="inline-flex"
      style={attention ? { boxShadow: "var(--rs-glow-news-unread)" } : undefined}
    >
      <button
        aria-haspopup="dialog"
        aria-label={chatSocialLauncherLabel(attentionCount)}
        className={`rs-bevel rs-focus relative flex h-[var(--rs-touch-target)] w-[var(--rs-touch-target)] items-center justify-center border bg-[color:var(--rs-surface-control)] transition duration-[var(--rs-duration-fast)] ${
          attention
            ? "border-[color:var(--rs-accent-primary)] text-[color:var(--rs-accent-primary)]"
            : "border-[color:var(--rs-border-structural)] text-[color:var(--rs-text-primary)] hover:border-[color:var(--rs-accent-secondary)]"
        }`}
        data-chat-social-launcher=""
        data-realtime-status={status}
        onClick={onOpen}
        ref={ref}
        type="button"
      >
        <MessagesSquare aria-hidden="true" className="h-5 w-5" />
        {attention ? (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full border border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-surface-control)] px-0.5 font-display text-[9px] font-bold leading-none text-[color:var(--rs-accent-primary)]"
            data-chat-social-attention={attentionCount}
          >
            {attentionCount > 9 ? "9+" : attentionCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}

/** The launcher wired to this tab's social state. */
export function SocialLauncher() {
  const { attentionCount, launcherRef, openSocial, status } = useSocial();
  return (
    <ChatSocialLauncher
      attentionCount={attentionCount}
      onOpen={openSocial}
      ref={launcherRef}
      status={status}
    />
  );
}
