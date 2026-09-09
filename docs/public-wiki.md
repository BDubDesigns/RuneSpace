# Public Wiki

The RuneSpace Wiki is a repository-authored player manual. It is documentation
for players about **currently shipped** RuneSpace behavior — a narrow
publishing path, not a CMS, a generic content platform, or Markdown/MDX.

## Add or edit an article

Add or edit an object in `authoredWikiArticles` in
`features/public-site/public-wiki.ts`. The schema in
`game/schemas/public-wiki.ts` validates the collection when it is imported
during the build.

Every article requires:

- `slug`: a stable lowercase kebab-case route segment. It becomes
  `/wiki/<slug>`; do not change it after publication.
- `title`: the player-facing article title.
- `summary`: the short excerpt shown on the `/wiki` index and used as the
  page's meta description.
- `sections`: an ordered array of content blocks, each with an optional
  `heading`, one or more `paragraphs`, and an optional `list` of short items.

There is no `publishedAt`/date field and no category metadata. The `/wiki`
index renders articles in the exact order they appear in
`authoredWikiArticles` — authored order **is** the index grouping. Reorder
the array to change the index; do not add a second ordering mechanism.

A `paragraphs` entry is ordinary prose (a string), or — only when a specific
phrase should link to another Wiki article — an array of segments mixing
plain strings with `{ text, articleSlug }` link objects that concatenate into
the same prose. This is a deliberate, narrow, author-controlled link: you
choose exactly which phrase links where. Do not implement automatic
keyword replacement/autolinking, and do not extend this pattern to `list`
items or any richer inline formatting (bold, italics, etc.) — it exists only
for cross-linking related articles.

The collection rejects duplicate slugs, missing/malformed required fields,
and any link segment whose `articleSlug` does not match a real authored
article.
`getWikiArticles()` returns the validated collection in authored order;
`getWikiArticle(slug)` looks up one article; `getWikiArticlePath(article)` is
the single canonical route projection used by the index, the article route,
and `generateStaticParams`.

## Verify facts before publishing

Wiki facts must come from **currently shipped** gameplay/content/config code
on `origin/main`, not from design documents, roadmap discussion, or internal
architecture notes. In particular, an approved design document (for example
`docs/holo-hollow.md`) describes **future or proposed** direction only —
never treat it as evidence that a system, NPC, location, or mechanic is
playable. When a design document and the actual shipped implementation
disagree, the implementation wins.

Before adding or changing a fact, check the relevant authoritative content
(`game/content/`, `game/config/balance.ts`) and the focused current-behavior
docs (`docs/gameplay-foundations.md`, `docs/missions.md`) rather than
reasoning from memory or from prose.

Wiki prose is player-facing only. Use exact current in-game names for
locations, missions, NPCs, items, and skills. Avoid implementation language
(server authority, resolver, projection, schema, persistence transaction,
canonical ID, mission requirement kind, or similar internals) unless a plain
player-facing consequence is what is actually being explained. Only document
a stat, skill, or mechanic that is actually presented to players somewhere in
the game — an internal value that merely contributes to a visible mechanic
(without itself appearing in any player-facing surface) does not belong in
the Wiki.

## Images

Images are optional and out of scope for the initial Wiki. If a future
article genuinely needs one, follow the same repository-owned convention as
Update hero images (`game/schemas/public-updates.ts`'s `PublicUpdateHeroSchema`):
a committed asset path, real `alt`, `width`, and `height` — never a remote URL
or a generated/source-only asset.

## Search

The Wiki intentionally has no search in v1. The index is a short, ordered
list; do not add a search dependency, client search index, or search service
until real content volume demonstrates a need.

## Maintaining the Wiki

When a gameplay/content/UX/balance/progression change materially changes a
fact already documented in the Wiki, update the affected article(s) in the
**same PR** unless the issue says otherwise.

Add a new article only when the new player-facing information does not fit
cleanly into an existing article; otherwise update the most relevant existing
article(s). Do not use a blanket "new feature = new article" rule, and do not
create a page per internal registry/entity, item, NPC, action, or mechanic by
default — a new page earns its place only when the genuinely new player-facing
information volume warrants a standalone article. Do not add empty placeholder
pages for unshipped systems.

Internal-only CI/test/refactor/architecture work does not require a Wiki
update unless it changes actual player-visible behavior.
