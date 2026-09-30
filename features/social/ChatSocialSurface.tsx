import type { SocialCard } from "./social-state";

/**
 * The Chat/Social content (issue #245), independent of how it is presented:
 * today inside the Drawer, later possibly docked beside Play on desktop.
 *
 * Current actionable social cards are pinned above ordinary conversation
 * content so they are never buried in a channel. Each card's content and
 * actions belong to its owning domain (trade requests are #225's); the
 * surface only places them. General, Trade, and Whispers fill the
 * conversation region in #246 and #247; until then it says so plainly.
 */
export function ChatSocialSurface({ cards }: { cards: readonly SocialCard[] }) {
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
        <p className="text-sm text-[color:var(--rs-text-muted)]">Chat coming soon.</p>
      </section>
    </div>
  );
}
