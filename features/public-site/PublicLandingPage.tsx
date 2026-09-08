import Image from "next/image";
import { RuneSpaceBrand } from "@/components/branding/RuneSpaceBrand";
import { PublicSiteShell } from "@/components/public-site/PublicSiteShell";
import { ActionLink } from "@/components/ui/ActionLink";
import { Panel } from "@/components/ui/Panel";
import {
  formatPublicUpdateDate,
  getLatestPublishedUpdate,
  getPublicUpdatePath,
} from "./public-updates";
import { publicLandingContent, publicSiteNavigation } from "./public-site-content";

function BuildSignal({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-[color:var(--rs-border-subtle)] py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span className="font-display text-[10px] uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)]">
        {label}
      </span>
      <span className="text-right text-sm font-semibold text-[color:var(--rs-text-primary)]">
        {value}
      </span>
    </div>
  );
}

function PublicSectionHeader({
  eyebrow,
  id,
  children,
}: {
  eyebrow: string;
  id: string;
  children: string;
}) {
  return (
    <header>
      <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
        {eyebrow}
      </p>
      <h2
        className="mt-2 font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-3xl"
        id={id}
      >
        {children}
      </h2>
    </header>
  );
}

export function PublicLandingPage({ signedIn }: { signedIn: boolean }) {
  const { adventure, buildSignal, capabilities, currentBuild, hero, showcase, status } =
    publicLandingContent;
  const latestUpdate = getLatestPublishedUpdate();
  const prominentActionClassName = "min-h-14 px-6 py-3 text-base sm:min-h-16 sm:px-8 sm:text-lg";

  const playEntry = signedIn ? (
    <ActionLink href="/characters">My characters</ActionLink>
  ) : (
    <ActionLink href="/sign-in" intent="secondary">
      Sign in
    </ActionLink>
  );

  return (
    <PublicSiteShell headerActions={playEntry} navigation={publicSiteNavigation}>
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:pb-24">
        <section className="grid min-w-0 gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)] lg:items-end lg:gap-16 lg:py-24">
          <div className="min-w-0">
            <p className="font-display text-xs uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]">
              {hero.eyebrow}
            </p>
            <p className="mt-3 inline-flex border border-[color:var(--rs-accent-success)] bg-[color:var(--rs-accent-success-subtle)] px-2 py-1 font-display text-xs font-bold uppercase tracking-[0.12em] text-[color:var(--rs-accent-success)]">
              {hero.status}
            </p>
            <h1 className="mt-5 max-w-2xl">
              <RuneSpaceBrand
                className="block h-auto w-full max-w-[min(28rem,100%)]"
                priority
                sizes="(max-width: 640px) 82vw, 448px"
              />
            </h1>
            <h2 className="mt-8 max-w-3xl font-display text-3xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-5xl">
              {hero.title}
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[color:var(--rs-text-secondary)] sm:text-lg">
              {hero.description}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {signedIn ? (
                <ActionLink className={prominentActionClassName} href="/characters">
                  My characters
                </ActionLink>
              ) : (
                <>
                  <ActionLink className={prominentActionClassName} href="/register">
                    Register
                  </ActionLink>
                  <ActionLink
                    className={prominentActionClassName}
                    href="/sign-in"
                    intent="secondary"
                  >
                    Sign in
                  </ActionLink>
                </>
              )}
            </div>
          </div>

          <aside className="rs-bevel min-w-0 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] p-5 shadow-[var(--rs-shadow-panel)] sm:p-6">
            <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
              Build signal
            </p>
            <p className="mt-3 font-display text-2xl font-bold text-[color:var(--rs-text-primary)]">
              PLAYABLE
            </p>
            <div className="mt-6">
              {buildSignal.map((signal) => (
                <BuildSignal key={signal.label} label={signal.label} value={signal.value} />
              ))}
            </div>
          </aside>
        </section>

        <section aria-labelledby="current-build-heading" className="scroll-mt-8 pt-4 sm:pt-8">
          <PublicSectionHeader eyebrow={currentBuild.eyebrow} id="current-build-heading">
            {currentBuild.title}
          </PublicSectionHeader>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[color:var(--rs-text-secondary)] sm:text-base">
            {currentBuild.description}
          </p>
          <div className="mt-8 grid min-w-0 gap-5 lg:grid-cols-2">
            {showcase.map((view, index) => (
              <figure
                className={`min-w-0 overflow-hidden border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] shadow-[var(--rs-shadow-panel)] ${index === 0 ? "lg:col-span-2" : ""}`}
                key={view.src}
              >
                <div className="relative overflow-hidden border-b border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-page)]">
                  <Image
                    alt={view.alt}
                    className="block h-auto w-full"
                    height={view.height}
                    sizes={
                      index === 0
                        ? "(max-width: 1024px) 100vw, 1152px"
                        : "(max-width: 1024px) 100vw, 576px"
                    }
                    src={view.src}
                    width={view.width}
                  />
                </div>
                <figcaption className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="font-display text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--rs-accent-primary)]">
                    {view.label}
                  </span>
                  <span className="text-right text-sm text-[color:var(--rs-text-secondary)]">
                    {view.detail}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section aria-labelledby="latest-update-heading" className="pt-20 sm:pt-28">
          <div className="border-y border-[color:var(--rs-border-structural)] py-8 sm:flex sm:items-end sm:justify-between sm:gap-12 sm:py-10">
            <div className="min-w-0">
              <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
                Latest update
              </p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--rs-text-muted)]">
                <time dateTime={latestUpdate.publishedAt}>
                  {formatPublicUpdateDate(latestUpdate.publishedAt)}
                </time>
              </p>
              <h2
                className="mt-2 max-w-2xl font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-3xl"
                id="latest-update-heading"
              >
                {latestUpdate.title}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--rs-text-secondary)] sm:text-base">
                {latestUpdate.summary}
              </p>
            </div>
            <ActionLink className="mt-6 shrink-0 sm:mt-0" href={getPublicUpdatePath(latestUpdate)}>
              Read update
            </ActionLink>
          </div>
        </section>

        <section aria-labelledby="capabilities-heading" className="pt-20 sm:pt-28">
          <PublicSectionHeader eyebrow="The current loop" id="capabilities-heading">
            What you can do now
          </PublicSectionHeader>
          <div className="mt-8 grid min-w-0 gap-x-10 sm:grid-cols-2">
            {capabilities.map((capability) => (
              <article
                className="min-w-0 border-t border-[color:var(--rs-border-structural)] py-5 sm:py-6"
                key={capability.number}
              >
                <div className="flex gap-4">
                  <span
                    aria-hidden="true"
                    className="pt-1 font-display text-xs font-bold tracking-[0.14em] text-[color:var(--rs-accent-mining)]"
                  >
                    {capability.number}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-display text-lg font-bold text-[color:var(--rs-text-primary)]">
                      {capability.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--rs-text-secondary)]">
                      {capability.copy}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="adventure-heading" className="pt-20 sm:pt-28">
          <Panel
            tone="raised"
            className="grid min-w-0 gap-8 !p-6 sm:!p-8 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16"
          >
            <div>
              <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
                {adventure.eyebrow}
              </p>
              <h2
                className="mt-3 font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-3xl"
                id="adventure-heading"
              >
                {adventure.title}
              </h2>
            </div>
            <div className="space-y-4 text-sm leading-6 text-[color:var(--rs-text-secondary)] sm:text-base">
              {adventure.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </Panel>
        </section>

        <section aria-labelledby="status-heading" className="pt-20 sm:pt-28">
          <div className="border-y border-[color:var(--rs-border-structural)] py-8 sm:flex sm:items-start sm:justify-between sm:gap-12 sm:py-10">
            <div className="min-w-0">
              <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
                {status.eyebrow}
              </p>
              <h2
                className="mt-3 font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-3xl"
                id="status-heading"
              >
                {status.title}
              </h2>
            </div>
            <p className="mt-4 max-w-xl text-sm leading-6 text-[color:var(--rs-text-secondary)] sm:mt-0 sm:text-base">
              {status.body}
            </p>
          </div>
        </section>

        <section aria-labelledby="final-cta-heading" className="pt-20 sm:pt-28">
          <Panel
            tone="raised"
            className="flex min-w-0 flex-col items-start gap-6 !p-6 sm:!p-8 lg:flex-row lg:items-center lg:justify-between lg:gap-12"
          >
            <div className="min-w-0">
              <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
                Holo Hollow / Crash Site
              </p>
              <h2
                className="mt-3 max-w-2xl font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-3xl"
                id="final-cta-heading"
              >
                THE WRECK ISN&apos;T GOING TO FIX ITSELF.
              </h2>
              <p className="mt-3 text-sm leading-6 text-[color:var(--rs-text-secondary)] sm:text-base">
                Take the next job and keep the ship moving.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              {signedIn ? (
                <ActionLink className={prominentActionClassName} href="/characters">
                  My characters
                </ActionLink>
              ) : (
                <>
                  <ActionLink className={prominentActionClassName} href="/register">
                    Register
                  </ActionLink>
                  <ActionLink
                    className={prominentActionClassName}
                    href="/sign-in"
                    intent="secondary"
                  >
                    Sign in
                  </ActionLink>
                </>
              )}
            </div>
          </Panel>
        </section>
      </div>
    </PublicSiteShell>
  );
}
