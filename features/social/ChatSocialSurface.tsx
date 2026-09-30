import type { ReactNode } from "react";
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
 * Whispers (#247) — so the shell itself imports no chat model.
 */
export function ChatSocialSurface({
  cards,
  conversations,
}: {
  cards: readonly SocialCard[];
  conversations: ReactNode;
}) {
  return (
    <div className="mt-4 space-y-4">
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
      <section aria-label="Conversations" data-social-conversations="">
        {conversations}
      </section>
    </div>
  );
}
