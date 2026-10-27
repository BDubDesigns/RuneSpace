import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { PublicNavigation } from "./PublicNavigation";
import { RuneSpaceBrand } from "@/components/branding/RuneSpaceBrand";

const EMBLEM_WIDTH = 1292;
const EMBLEM_HEIGHT = 1340;

/**
 * The emblem leaves room for public links on phones; wide layouts keep the
 * full lockup. The landing hero retains its own full-size logo. Both header
 * assets load lazily so the hidden breakpoint variant is not preloaded.
 */

export type PublicSiteNavItem = {
  href: string;
  label: string;
};

const defaultNavigation: readonly PublicSiteNavItem[] = [];

/**
 * Presentational header, page frame, and footer for public RuneSpace pages.
 * `footerLinks` are internal pages every public page should reach, such as
 * the published player policies (issue #248); the header navigation stays
 * unchanged.
 */
export function PublicSiteShell({
  children,
  headerActions,
  navigation = defaultNavigation,
  footerLinks = defaultNavigation,
}: {
  children: ReactNode;
  headerActions?: ReactNode;
  navigation?: readonly PublicSiteNavItem[];
  footerLinks?: readonly PublicSiteNavItem[];
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
              className="hidden h-10 w-auto max-w-[min(46vw,12rem)] sm:h-11 sm:max-w-[13rem] min-[680px]:block"
              priority={false}
              sizes="(max-width: 640px) 46vw, 208px"
            />
            <Image
              alt="RuneSpace"
              className="block h-10 w-auto min-[680px]:hidden"
              height={EMBLEM_HEIGHT}
              sizes="40px"
              src="/branding/runespace-emblem.png"
              width={EMBLEM_WIDTH}
            />
          </Link>
          {navigation.length > 0 ? <PublicNavigation items={navigation} /> : null}
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
            {footerLinks.map((item) => (
              <Link
                className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center text-[color:var(--rs-accent-primary)] underline"
                href={item.href}
                key={`${item.href}-${item.label}`}
              >
                {item.label}
              </Link>
            ))}
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
