import type { ReactNode } from "react";
import { COMMUNITY_RULES_PATH, SAFETY_PRIVACY_PATH } from "@/features/public-site/policy-links";
import type { SocialCard } from "./social-state";

/**
 * The Chat/Social content (issue #245), independent of how it is presented:
 * today inside the Drawer, later possibly docked beside Play on desktop.
 *
 * Current actionable social cards are pinned above ordinary conversation
 * content so they are never buried in a channel. Each card's content and
 * actions belong to its owning domain (trade requests are #225's); the
 * surface only places them. The conversation region renders whatever
 * conversations Play composes into it — General and Trade (#246), later
 * Whispers (#247) — so the shell itself imports no chat model. A footer links
 * the Community Rules and Safety & Privacy pages (#248).
 */
export function ChatSocialSurface({
  cards,
  conversations,
}: {
  cards: readonly SocialCard[];
  conversations: ReactNode;
}) {
  return (
    <div className="mt-4 flex flex-1 flex-col gap-4">
      {cards.length > 0 ? (
        <section aria-label="Needs your attention" data-social-pinned-cards="">
          <ul className="space-y-2">
            {cards.map((card) => (
              <li aria-label={card.label} data-social-card={card.key} key={card.key}>
                {card.content}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section
        aria-label="Conversations"
        className="flex flex-1 flex-col"
        data-social-conversations=""
      >
        {conversations}
      </section>
      {/* The published policies (#248), in a new tab so the player keeps their
          place in Play. */}
      <footer
        className="flex flex-wrap gap-x-4 border-t border-[color:var(--rs-border-structural)] pt-2 text-xs"
        data-social-policy-links=""
      >
        <a
          className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center text-[color:var(--rs-accent-primary)] underline underline-offset-2"
          href={COMMUNITY_RULES_PATH}
          rel="noreferrer"
          target="_blank"
        >
          Community Rules
        </a>
        <a
          className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center text-[color:var(--rs-accent-primary)] underline underline-offset-2"
          href={SAFETY_PRIVACY_PATH}
          rel="noreferrer"
          target="_blank"
        >
          Safety &amp; Privacy
        </a>
      </footer>
    </div>
  );
}
