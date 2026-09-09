import Link from "next/link";
import type { ReactNode } from "react";
import { PublicSiteShell } from "@/components/public-site/PublicSiteShell";
import { ActionLink } from "@/components/ui/ActionLink";
import { Panel } from "@/components/ui/Panel";
import { getWikiArticlePath, getWikiArticles, type WikiArticle } from "./public-wiki";
import { publicSiteNavigation } from "./public-site-content";

export function PublicWikiIndexPage() {
  const articles = getWikiArticles();

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

      <ol className="mt-10 grid gap-5" aria-label="Wiki articles">
        {articles.map((article) => (
          <li key={article.slug}>
            <Panel className="min-w-0" tone="raised">
              <h2 className="font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-3xl">
                <Link
                  className="rs-focus rounded-sm text-[color:var(--rs-text-primary)] underline decoration-[color:var(--rs-accent-primary)] decoration-2 underline-offset-4 hover:text-[color:var(--rs-accent-primary)]"
                  href={getWikiArticlePath(article)}
                >
                  {article.title}
                </Link>
              </h2>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-[color:var(--rs-text-secondary)] sm:text-base">
                {article.summary}
              </p>
              <ActionLink className="mt-6" href={getWikiArticlePath(article)}>
                Read article
              </ActionLink>
            </Panel>
          </li>
        ))}
      </ol>
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
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
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
                  {section.list.map((item) => (
                    <li key={item}>{item}</li>
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
