import Link from "next/link";
import type { ReactNode } from "react";
import { RuneSpaceBrand } from "@/components/branding/RuneSpaceBrand";

export type PublicSiteNavItem = {
  href: string;
  label: string;
};

const defaultNavigation: readonly PublicSiteNavItem[] = [{ href: "/", label: "Home" }];

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
              className="block h-10 w-auto max-w-[min(46vw,12rem)] sm:h-11 sm:max-w-[13rem]"
              priority
              sizes="(max-width: 640px) 46vw, 208px"
            />
          </Link>
          <nav aria-label="Public" className="hidden min-w-0 flex-1 sm:block">
            <ul className="flex items-center gap-5">
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
          {headerActions ? <div className="ml-auto shrink-0">{headerActions}</div> : null}
        </div>
      </header>

      <main className="min-w-0 flex-1">{children}</main>

      <footer className="border-t border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-[color:var(--rs-text-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>RuneSpace is licensed under AGPL-3.0.</p>
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
