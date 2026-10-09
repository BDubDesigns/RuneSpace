import Link from "next/link";
import type { ReactNode } from "react";
import Image from "next/image";
import { Panel } from "@/components/ui/Panel";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { PublicWikiFrame } from "./PublicWikiPage";
import {
  getWikiItemGroups,
  type WikiItemLine,
  type WikiItemPage,
  wikiItemPath,
} from "./public-item-wiki";
import { WIKI_ITEMS_PATH } from "./public-wiki";

const linkClassName =
  "rs-focus rounded-sm underline decoration-[color:var(--rs-accent-primary)] decoration-2 underline-offset-2 hover:text-[color:var(--rs-accent-primary)]";

const backLinkClassName =
  "rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center text-sm font-semibold text-[color:var(--rs-accent-primary)] underline underline-offset-4";

const headingClassName =
  "font-display text-xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-2xl";

function ItemLine({ line }: { line: WikiItemLine }) {
  return (
    <>
      {line.map((segment, index) =>
        typeof segment === "string" ? (
          <span key={index}>{segment}</span>
        ) : (
          <Link className={linkClassName} href={segment.href} key={index}>
            {segment.text}
          </Link>
        ),
      )}
    </>
  );
}

function LineList({ lines }: { lines: readonly WikiItemLine[] }) {
  return (
    <ul className="list-disc space-y-3 pl-5 text-base leading-7 text-[color:var(--rs-text-secondary)]">
      {lines.map((line, index) => (
        <li key={index}>
          <ItemLine line={line} />
        </li>
      ))}
    </ul>
  );
}

function Section({ children, heading, id }: { children: ReactNode; heading: string; id: string }) {
  return (
    <section aria-labelledby={id}>
      <h2 className={headingClassName} id={id}>
        {heading}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * The item's artwork with its authored accessibility text, or its authored text
 * fallback when it has none. Decorative frame only: the name is the page's h1.
 */
function ItemArtwork({ itemId, name }: { itemId: string; name: string }) {
  const presentation = resolveItemPresentation(itemId, name);
  return (
    <div className="flex h-32 w-32 shrink-0 items-center justify-center border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3">
      {presentation.artworkSrc ? (
        <Image
          alt={presentation.accessibleDescription}
          className="h-full w-full object-contain"
          height={160}
          priority
          sizes="112px"
          src={presentation.artworkSrc}
          width={160}
        />
      ) : (
        <span
          aria-label={presentation.accessibleDescription}
          className="font-display text-sm uppercase tracking-[0.16em] text-[color:var(--rs-text-secondary)]"
          role="img"
        >
          {presentation.textFallback}
        </span>
      )}
    </div>
  );
}

/** `/wiki/items`: every shipped item, once, grouped by what it is. */
export function PublicWikiItemsPage() {
  const groups = getWikiItemGroups();

  return (
    <PublicWikiFrame>
      <Link className={backLinkClassName} href="/wiki">
        ← All Wiki
      </Link>

      <header className="mt-8 max-w-3xl">
        <p className="font-display text-xs uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]">
          RuneSpace / Wiki
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-5xl">
          Items &amp; Recipes
        </h1>
        <p className="mt-5 text-base leading-7 text-[color:var(--rs-text-secondary)] sm:text-lg sm:leading-8">
          Every item in RuneSpace, grouped by what it is. Open one to see its properties, every way
          to get it, the recipes that make it, and what uses it.
        </p>
      </header>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {groups.map((group) => (
          <Panel className="min-w-0" key={group.id} tone="raised">
            <h2
              className="font-display text-lg font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-xl"
              id={`items-${group.id}`}
            >
              {group.label}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--rs-text-secondary)]">
              {group.description}
            </p>
            <ul aria-labelledby={`items-${group.id}`} className="mt-3">
              {group.items.map((item) => (
                <li key={item.itemId}>
                  <Link
                    className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center rounded-sm text-sm font-semibold text-[color:var(--rs-accent-primary)] underline underline-offset-4"
                    href={wikiItemPath(item.itemId)}
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </PublicWikiFrame>
  );
}

/** `/wiki/items/<slug>`: one item, in the fixed section order. */
export function PublicWikiItemPage({ page }: { page: WikiItemPage }) {
  return (
    <PublicWikiFrame>
      <nav aria-label="Wiki navigation" className="flex flex-wrap gap-x-6">
        <Link className={backLinkClassName} href={WIKI_ITEMS_PATH}>
          ← Items &amp; Recipes
        </Link>
        <Link className={backLinkClassName} href="/wiki">
          All Wiki
        </Link>
      </nav>

      <article className="mt-8 min-w-0">
        <header className="flex max-w-3xl flex-col gap-6 sm:flex-row sm:items-start">
          <ItemArtwork itemId={page.itemId} name={page.name} />
          <div className="min-w-0">
            <p className="font-display text-xs uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]">
              {page.categoryLabel}
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-[color:var(--rs-text-primary)] sm:text-5xl">
              {page.name}
            </h1>
            <p className="mt-5 text-base leading-7 text-[color:var(--rs-text-secondary)] sm:text-lg sm:leading-8">
              {page.description ?? page.summary}
            </p>
          </div>
        </header>

        <div className="mt-10 max-w-3xl space-y-8">
          <Section heading="Properties" id="properties">
            <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-6 gap-y-2 text-base leading-7">
              {page.properties.map((property) => (
                <div className="contents" key={property.label}>
                  <dt className="font-semibold text-[color:var(--rs-text-primary)]">
                    {property.label}
                  </dt>
                  <dd className="text-[color:var(--rs-text-secondary)]">{property.value}</dd>
                </div>
              ))}
            </dl>
          </Section>

          {page.obtain.length > 0 || page.oneTime.length > 0 || page.byproducts.length > 0 ? (
            <Section heading="How to Obtain" id="how-to-obtain">
              <div className="space-y-6">
                {page.obtain.length > 0 ? <LineList lines={page.obtain} /> : null}
                {page.oneTime.length > 0 ? (
                  <div>
                    <h3 className="font-display text-base font-bold text-[color:var(--rs-text-primary)]">
                      One-time Mission payouts
                    </h3>
                    <div className="mt-2">
                      <LineList lines={page.oneTime} />
                    </div>
                  </div>
                ) : null}
                {page.byproducts.length > 0 ? (
                  <div>
                    <h3 className="font-display text-base font-bold text-[color:var(--rs-text-primary)]">
                      Byproducts
                    </h3>
                    <div className="mt-2">
                      <LineList lines={page.byproducts} />
                    </div>
                  </div>
                ) : null}
              </div>
            </Section>
          ) : null}

          {page.recipes.length > 0 ? (
            <Section heading="Recipes" id="recipes">
              <div className="space-y-4">
                {page.recipes.map((recipe) => (
                  <Panel className="min-w-0" key={recipe.key} tone="raised">
                    <h3 className="font-display text-base font-bold text-[color:var(--rs-text-primary)]">
                      {recipe.heading}: {recipe.yields}
                    </h3>
                    <p className="mt-3 text-sm font-semibold text-[color:var(--rs-text-primary)]">
                      Ingredients
                    </p>
                    <div className="mt-1">
                      <LineList lines={recipe.inputs} />
                    </div>
                    <div className="mt-3">
                      <LineList lines={recipe.facts} />
                    </div>
                  </Panel>
                ))}
              </div>
            </Section>
          ) : null}

          {page.usedIn.length > 0 ? (
            <Section heading="Used In" id="used-in">
              <div className="space-y-6">
                {page.usedIn.map((group) => (
                  <div key={group.heading}>
                    <h3 className="font-display text-base font-bold text-[color:var(--rs-text-primary)]">
                      {group.heading}
                    </h3>
                    <div className="mt-2">
                      <LineList lines={group.lines} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}
        </div>
      </article>
    </PublicWikiFrame>
  );
}
