import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { PublicSiteShell } from "@/components/public-site/PublicSiteShell";
import { ActionLink } from "@/components/ui/ActionLink";
import { Panel } from "@/components/ui/Panel";
import {
  formatPublicUpdateDate,
  getPublicUpdatePath,
  getPublishedUpdates,
  type PublicUpdate,
} from "./public-updates";
import { publicSiteNavigation } from "./public-site-content";

function PublicationDate({ publishedAt }: { publishedAt: string }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--rs-text-muted)]">
      Published <time dateTime={publishedAt}>{formatPublicUpdateDate(publishedAt)}</time>
    </p>
  );
}

export function PublicUpdatesPage() {
  const updates = getPublishedUpdates();

  return (
    <PublicUpdatesFrame>
      <header className="max-w-2xl">
        <p className="font-display text-xs uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]">
          Field notes / release log
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-5xl">
          Updates
        </h1>
        <p className="mt-5 text-base leading-7 text-[color:var(--rs-text-secondary)] sm:text-lg">
          Player-facing notes from Holo Hollow: what changed, what is playable, and where the wreck
          is headed next.
        </p>
      </header>

      <ol className="mt-10 grid gap-5" aria-label="Published Updates">
        {updates.map((update) => (
          <li key={update.slug}>
            <Panel className="min-w-0" tone="raised">
              <PublicationDate publishedAt={update.publishedAt} />
              <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-3xl">
                <Link
                  className="rs-focus rounded-sm text-[color:var(--rs-text-primary)] underline decoration-[color:var(--rs-accent-primary)] decoration-2 underline-offset-4 hover:text-[color:var(--rs-accent-primary)]"
                  href={getPublicUpdatePath(update)}
                >
                  {update.title}
                </Link>
              </h2>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-[color:var(--rs-text-secondary)] sm:text-base">
                {update.summary}
              </p>
              <ActionLink className="mt-6" href={getPublicUpdatePath(update)}>
                Read update
              </ActionLink>
            </Panel>
          </li>
        ))}
      </ol>
    </PublicUpdatesFrame>
  );
}

export function PublicUpdateArticlePage({ update }: { update: PublicUpdate }) {
  return (
    <PublicUpdatesFrame>
      <Link
        className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center text-sm font-semibold text-[color:var(--rs-accent-primary)] underline underline-offset-4"
        href="/updates"
      >
        ← All updates
      </Link>

      <article className="mt-8 min-w-0">
        <header className="max-w-3xl">
          <p className="font-display text-xs uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]">
            RuneSpace / Update
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-5xl">
            {update.title}
          </h1>
          <div className="mt-5">
            <PublicationDate publishedAt={update.publishedAt} />
          </div>
          <p className="mt-5 text-base leading-7 text-[color:var(--rs-text-secondary)] sm:text-lg sm:leading-8">
            {update.summary}
          </p>
        </header>

        {update.hero ? (
          <figure className="mt-10 overflow-hidden border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] shadow-[var(--rs-shadow-panel)]">
            <Image
              alt={update.hero.alt}
              className="block h-auto w-full"
              height={update.hero.height}
              sizes="(max-width: 1024px) 100vw, 896px"
              src={update.hero.src}
              width={update.hero.width}
            />
            <figcaption className="border-t border-[color:var(--rs-border-structural)] px-4 py-3 text-xs text-[color:var(--rs-text-muted)]">
              A current view from the playable build.
            </figcaption>
          </figure>
        ) : null}

        <div className="mt-10 max-w-3xl space-y-6 text-base leading-8 text-[color:var(--rs-text-secondary)]">
          {update.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>

        <section aria-labelledby="patch-notes-heading" className="mt-12 max-w-3xl">
          <h2
            className="font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-3xl"
            id="patch-notes-heading"
          >
            Patch notes
          </h2>
          <div className="mt-6 grid gap-5">
            {update.patchNotes.map((section) => (
              <Panel key={section.heading}>
                <h3 className="font-display text-lg font-bold text-[color:var(--rs-accent-mining)]">
                  {section.heading}
                </h3>
                <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-6 text-[color:var(--rs-text-secondary)] sm:text-base">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        </section>
      </article>
    </PublicUpdatesFrame>
  );
}

function PublicUpdatesFrame({ children }: { children: ReactNode }) {
  return (
    <PublicSiteShell navigation={publicSiteNavigation}>
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-16">
        {children}
      </div>
    </PublicSiteShell>
  );
}
