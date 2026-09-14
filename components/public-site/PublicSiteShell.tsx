import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { RuneSpaceBrand } from "@/components/branding/RuneSpaceBrand";

const EMBLEM_WIDTH = 1292;
const EMBLEM_HEIGHT = 1340;

/**
 * Below `min-[390px]`, the full horizontal lockup plus Home/Updates/Wiki no
 * longer fits the compact public header without the nav strip needing an
 * internal scroll. Only below that breakpoint, swap to the standalone R
 * emblem (`public/branding/runespace-emblem.png`) so the nav fits without
 * scrolling; the full lockup remains the header identity everywhere else.
 * This swap is deliberately scoped to the public-site header only — it does
 * not change the authenticated game header or general branding guidance.
 *
 * Neither header identity is `priority` (issue #117). A CSS breakpoint decides
 * which of the two is displayed, but a preload is unconditional: measured at
 * 390 px the hidden emblem still cost 9,218 B, and at 360 px the hidden lockup
 * still cost 32,334 B. Left to lazy loading the browser skips the one with no
 * layout box entirely and fetches only the visible mark, which is in the
 * initial viewport and therefore still requested immediately — no viewport
 * JavaScript, no hydration branch, no second asset. The landing hero lockup
 * below keeps its own `priority`; it is the large visible brand moment.
 */

export type PublicSiteNavItem = {
  href: string;
  label: string;
};

const defaultNavigation: readonly PublicSiteNavItem[] = [];

/** Presentational header, page frame, and footer for public RuneSpace pages. */
export function PublicSiteShell({
  children,
  headerActions,
  navigation = defaultNavigation,
}: {
  children: ReactNode;
  headerActions?: ReactNode;
  navigation?: readonly PublicSiteNavItem[];
}) {
  return (
    <div className="rs-viewport-shell flex min-w-0 flex-col">
      <header className="border-b border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-navigation)]">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link
            aria-label="RuneSpace home"
            className="rs-focus shrink-0 rounded-sm outline-none"
            href="/"
          >
            <RuneSpaceBrand
              className="hidden h-10 w-auto max-w-[min(46vw,12rem)] min-[390px]:block sm:h-11 sm:max-w-[13rem]"
              priority={false}
              sizes="(max-width: 640px) 46vw, 208px"
            />
            <Image
              alt="RuneSpace"
              className="block h-10 w-auto min-[390px]:hidden"
              height={EMBLEM_HEIGHT}
              sizes="40px"
              src="/branding/runespace-emblem.png"
              width={EMBLEM_WIDTH}
            />
          </Link>
          {navigation.length > 0 ? (
            <nav aria-label="Public" className="min-w-0 flex-1 overflow-x-auto">
              <ul className="flex min-w-max items-center gap-4 sm:gap-5">
                {navigation.map((item) => (
                  <li key={`${item.href}-${item.label}`}>
                    <Link
                      className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center text-sm font-semibold text-[color:var(--rs-text-secondary)] underline-offset-4 transition duration-[var(--rs-duration-fast)] hover:text-[color:var(--rs-text-primary)] hover:underline"
                      href={item.href}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          {headerActions ? <div className="ml-auto shrink-0">{headerActions}</div> : null}
        </div>
      </header>

      <main className="min-w-0 flex-1">{children}</main>

      <footer className="border-t border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-[color:var(--rs-text-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <p>RuneSpace is licensed under AGPL-3.0.</p>
            <p>
              Built by{" "}
              <a
                className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center text-[color:var(--rs-accent-primary)] underline"
                href="https://github.com/BDubDesigns"
                rel="noreferrer"
                target="_blank"
              >
                Brandon
              </a>
            </p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <a
              className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center text-[color:var(--rs-accent-primary)] underline"
              href="https://github.com/BDubDesigns/RuneSpace"
              rel="noreferrer"
              target="_blank"
            >
              Source code
            </a>
            <a
              className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center text-[color:var(--rs-accent-primary)] underline"
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              rel="noreferrer"
              target="_blank"
            >
              License
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
