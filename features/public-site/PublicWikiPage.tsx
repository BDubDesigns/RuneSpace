import Link from "next/link";
import type { ReactNode } from "react";
import { PublicSiteShell } from "@/components/public-site/PublicSiteShell";
import { Panel } from "@/components/ui/Panel";
import type { WikiParagraph } from "@/game/schemas/public-wiki";
import {
  getWikiArticleGroups,
  getWikiArticlePath,
  getWikiStartHereArticle,
  type WikiArticle,
} from "./public-wiki";

const wikiLinkClassName =
  "rs-focus rounded-sm underline decoration-[color:var(--rs-accent-primary)] decoration-2 underline-offset-2 hover:text-[color:var(--rs-accent-primary)]";

function WikiParagraphText({ paragraph }: { paragraph: WikiParagraph }) {
  if (typeof paragraph === "string") return <>{paragraph}</>;

  return (
    <>
      {paragraph.map((segment, index) =>
        typeof segment === "string" ? (
          <span key={index}>{segment}</span>
        ) : (
          <Link
            className={wikiLinkClassName}
            href={getWikiArticlePath({ slug: segment.articleSlug })}
            key={index}
          >
            {segment.text}
          </Link>
        ),
      )}
    </>
  );
}
import { publicSiteNavigation } from "./public-site-content";

/**
 * The Wiki landing page.
 *
 * Deliberately navigational rather than a catalog: an intro, one prominent way
 * in for somebody who does not know what to read, and the five categories as
 * compact panels of direct article links. Every article stays one tap from
 * here, so there are no category routes to click through and no second table
 * of contents above the panels — the panels are the contents.
 */
export function PublicWikiIndexPage() {
  const groups = getWikiArticleGroups();
  const startHere = getWikiStartHereArticle();

  return (
    <PublicWikiFrame>
      <header className="max-w-2xl">
        <p className="font-display text-xs uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]">
          Field manual
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-5xl">
          Wiki
        </h1>
        <p className="mt-5 text-base leading-7 text-[color:var(--rs-text-secondary)] sm:text-lg">
          A compact guide to what's currently playable in Holo Hollow — how to travel, work, gear
          up, and take on the current missions.
        </p>
      </header>

      <section aria-labelledby="wiki-start-here" className="mt-10">
        <h2
          className="font-display text-xs font-bold uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]"
          id="wiki-start-here"
        >
          Start here
        </h2>
        <Panel className="mt-4 min-w-0" tone="raised">
          <Link
            className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center rounded-sm font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)] underline decoration-[color:var(--rs-accent-primary)] decoration-2 underline-offset-4 hover:text-[color:var(--rs-accent-primary)] sm:text-3xl"
            href={getWikiArticlePath(startHere)}
          >
            {startHere.title}
          </Link>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:var(--rs-text-secondary)] sm:text-base">
            {startHere.summary}
          </p>
        </Panel>
      </section>

      <section aria-labelledby="wiki-browse" className="mt-10">
        <h2
          className="font-display text-xs font-bold uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]"
          id="wiki-browse"
        >
          Browse by category
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {groups.map((group) => (
            <Panel className="min-w-0" key={group.id} tone="raised">
              <h3
                className="font-display text-lg font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-xl"
                id={`category-${group.id}`}
              >
                {group.label}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[color:var(--rs-text-secondary)]">
                {group.description}
              </p>
              <ul aria-labelledby={`category-${group.id}`} className="mt-3">
                {group.articles.map((article) => (
                  <li key={article.slug}>
                    <Link
                      className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center rounded-sm text-sm font-semibold text-[color:var(--rs-accent-primary)] underline underline-offset-4"
                      href={getWikiArticlePath(article)}
                    >
                      {article.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      </section>
    </PublicWikiFrame>
  );
}

export function PublicWikiArticlePage({ article }: { article: WikiArticle }) {
  return (
    <PublicWikiFrame>
      <Link
        className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center text-sm font-semibold text-[color:var(--rs-accent-primary)] underline underline-offset-4"
        href="/wiki"
      >
        ← All Wiki
      </Link>

      <article className="mt-8 min-w-0">
        <header className="max-w-3xl">
          <p className="font-display text-xs uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]">
            RuneSpace / Wiki
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-5xl">
            {article.title}
          </h1>
          <p className="mt-5 text-base leading-7 text-[color:var(--rs-text-secondary)] sm:text-lg sm:leading-8">
            {article.summary}
          </p>
        </header>

        <div className="mt-10 max-w-3xl space-y-8">
          {article.sections.map((section, index) => (
            <section key={section.heading ?? `section-${index}`}>
              {section.heading ? (
                <h2 className="font-display text-xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-2xl">
                  {section.heading}
                </h2>
              ) : null}
              {section.paragraphs ? (
                <div
                  className={
                    section.heading
                      ? "mt-4 space-y-4 text-base leading-8 text-[color:var(--rs-text-secondary)]"
                      : "space-y-4 text-base leading-8 text-[color:var(--rs-text-secondary)]"
                  }
                >
                  {section.paragraphs.map((paragraph, index) => (
                    <p key={index}>
                      <WikiParagraphText paragraph={paragraph} />
                    </p>
                  ))}
                </div>
              ) : null}
              {section.list ? (
                <ul
                  className={
                    section.heading || section.paragraphs
                      ? "mt-4 list-disc space-y-3 pl-5 text-base leading-7 text-[color:var(--rs-text-secondary)]"
                      : "list-disc space-y-3 pl-5 text-base leading-7 text-[color:var(--rs-text-secondary)]"
                  }
                >
                  {section.list.map((item, index) => (
                    <li key={index}>
                      <WikiParagraphText paragraph={item} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </article>
    </PublicWikiFrame>
  );
}

function PublicWikiFrame({ children }: { children: ReactNode }) {
  return (
    <PublicSiteShell navigation={publicSiteNavigation}>
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-16">
        {children}
      </div>
    </PublicSiteShell>
  );
}
