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
- `category`: one of the closed `WIKI_CATEGORY_IDS` in
  `game/schemas/public-wiki.ts`. Each id has a player-facing label and a
  one-line description in `WIKI_CATEGORIES`, in the order the `/wiki` index
  renders them. A typo cannot create a heading, and a category with no
  index-visible article fails the import-time `assertWikiCategoriesArePopulated`
  check in `features/public-site/public-wiki.ts`, which runs when the module
  loads rather than inside the schema.
- `summary`: the short excerpt used as the page's meta description (and shown
  under the "Start here" spotlight).
- `sections`: an ordered array of content blocks, each with an optional
  `heading`, and `paragraphs` and/or a `list` of short items — at least one of
  the two is required.

There is no `publishedAt`/date field. The `/wiki` index renders one panel per
category, in `WIKI_CATEGORIES` order, and within a panel lists articles in the
exact order they appear in `authoredWikiArticles` — authored order **is** the
order inside a category. Reorder the array to change a panel; do not add a
second ordering mechanism.

An article is optionally `showInIndex: false`. Absent means shown. It changes
only whether the category panels on `/wiki` list the article: a hidden article
is still a real `/wiki/<slug>` page, is still returned by `getWikiArticles()`
and `getWikiArticle(slug)`, is still in `generateStaticParams`, and every link
in or to it is still validated. It is a narrow exception, used when a
directory article already links a family of guides (today only the sixteen
Mission guides, below) and repeating them on the landing page would bury every
other entry. Do not use it to hide an article that nothing else links to.

Each entry in `paragraphs` or `list` is ordinary prose (a string), or — only
when a specific phrase should link to another Wiki article — an array of
segments mixing plain strings with `{ text, articleSlug }` link objects that
concatenate into the same prose. `paragraphs` and `list` entries share this
exact shape; there is no separate list-specific link mechanism. This is a
deliberate, narrow, author-controlled link: you choose exactly which phrase
links where. Do not implement automatic keyword replacement/autolinking, and
do not extend this pattern to any richer inline formatting (bold, italics,
etc.) — it exists only for cross-linking related articles.

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

Terminology: Mission is the official name of the gameplay system (the Mission
Log, objectives, prerequisites, guides). "Job", "work" and "commission" are fine
where they describe what an NPC is asking for, and Work Order is the separate
client-work system. Keep literal in-game labels ("Take the Job") exactly as
they appear.

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
create a page per internal registry/entity, item, action, or mechanic by
default — a new page earns its place only when the genuinely new player-facing
information volume warrants a standalone article. The Mission guides,
named-character pages and derived item reference below are the deliberate
exceptions. Do not add empty placeholder pages for unshipped systems.

### Mission guides

There is one deliberate, narrow exception to the rule above. **Each currently
shipped named Mission gets its own guide**, because players look a Mission up by name ("how do I
get Brace Yourself", "does Cutting Costs need A Cut Above") and a single page
for all sixteen buried the answer and mixed unrelated gates. The exception is
scoped to exactly that:

- it covers Missions in `MISSIONS` (`game/content/missions.ts`), one guide
  each with the slug `mission-<title in kebab-case>` (for example
  `mission-10000-hours`). It does not cover items, actions, repair targets, or
  any other registry, and it is not a precedent for a page per entity;
- `/wiki/missions` stays the hub. It owns the general Mission Log, pinning, and
  objective-guidance help and lists each guide once, grouped by how the Missions
  actually connect, never as one linear list. Do not repeat that general help
  inside guides, and do not copy walkthroughs into NPC or other generic
  articles; link to the guide instead;
- guides are filed under Getting Started with `showInIndex: false`, so the
  landing page links the Missions directory once. They live in
  `features/public-site/public-wiki-mission-guides.ts` only to keep
  `public-wiki.ts` readable. They join the same `authoredWikiArticles`
  collection, validation and routes as every other article;
- a guide covers, as each applies: where the Mission begins and who offers it,
  prerequisite Missions and skill levels, what it needs, a short walkthrough,
  what is paid and when, caveats, and links to the guides before and after it.
  Distinguish what the offer hands over, XP earned on the action itself, the
  turn-in reward, what unlocks, items consumed versus only shown, equipped
  versus carried, and automatic continuation versus a manual offer. State only
  what the Mission definition and repair recipes do, and write no reward the
  Mission does not pay;
- a link that names a specific Mission points at that Mission's guide; a link
  about the Mission Log or Missions in general points at `missions`.

A new shipped Mission adds a hub entry and a guide in the same PR; a changed
Mission updates its guide (and any gate on the hub) in the same PR. The
Items & Recipes reference below is separate from this.

### Items & Recipes (derived reference)

`/wiki/items` and `/wiki/items/<slug>` are **not editorial articles** and are
not in `authoredWikiArticles`. They are a generated reference to the shipped
item registry, and a deliberate exception to the "no page per registry entry"
rule. It covers items only; it is not a precedent for a page per action,
recipe, location or merchant, and there is still no separate recipe article.

- **Eligible items** are `inventoryItemDefinitions()` in
  `game/config/balance.ts` — the shipped inventory registry, not `ITEM_IDS`,
  which also names IDs that are not shipped items. The directory lists each
  exactly once; the slug is the stable item ID with `_` as `-`
  (`wheel_assembly` → `wheel-assembly`), never the display name. Unknown slugs
  and extra path segments 404.
- **Four editorial categories** (`game/content/item-categories.ts`) classify what
  an item *is*, never how it is obtained: Ores & Gemstones, Processed Materials,
  Components & Supplies, Tools & Containers. `validateItemCategories` fails the
  build when a shipped item has no category, a category names something that is
  not shipped, or a category is empty. A newly shipped item therefore needs one
  line there and nothing else.
- **Nothing is hand-copied.** Mass, stack capacity, equipment facts, recipes,
  prices, daily limits, Secondary Find odds, repair requirements and Mission
  requirements are read from their owning registries by
  `game/domain/item-reference.ts` and worded in
  `features/public-site/public-item-wiki.ts`. Do not add a number to either
  page's wording; change the registry and the Wiki follows.
- **Page layout**, in order and only when applicable: header and Properties;
  How to Obtain (ordinary sources, then separately labelled one-time Mission
  payouts and Refining-failure byproducts); Recipes (every Fabrication or
  Refining recipe that makes the item, with linked ingredients); Used In
  (recipe inputs, repair materials, and Mission requirements with their exact
  quantity, labelled as equipped, shown or handed in).
- **Public, not character-aware.** The Wiki lists every shipped source and states
  gates as requirements. It deliberately does not call the in-game resolver
  (`game/domain/item-sources.ts`, #326), whose discovery rules hide what a given
  character has not met; that behaviour is unchanged.
- **Workstation unlocks.** A Fabrication recipe states the Fabrication Station's
  unlock Mission (accepting it) separately from its skill level; both apply. The
  Missions come from `RUSK_RECOVERY_CONTENT`, never from item pages. Scrap Metal
  lists Tinkering (yield from `tinkeringScrapYield`, unlocked by completing its
  Mission; the dismantled item is consumed) and Slag lists Practice Welding
  (Scrap cost and Slag per weld from the Practice Welding balance, opened by
  accepting its Mission; Slag that does not fit is thrown out). Practice Slag is
  worded as a by-product that costs Scrap.
- **Wording rules.** A Secondary Find chance is stated per *successful*
  extraction, from its authored `oneIn`. Scavenging has no verified public
  probability and is described qualitatively. A merchant's `buyPrice` (what they
  pay the player) is never a source. Do not invent flavour text: only an item's
  authored `description` is shown, and an item without one gets a plain summary
  derived from its kind, group and mass.
- **Not covered:** Work Order payouts are not an item source, and pages do not
  yet list Tinkering or Practice Welding as *uses* of the items they consume.
  Mission links point at the published Mission guides.

### Named-character pages

There is a second deliberate, narrow exception to the rule above. **A named
recurring character in the NPC roster gets its own Wiki article**, because the
people of Holo Hollow are content players look up by name, not a registry the
Wiki happens to mirror.

The exception is scoped to exactly that, and does not widen:

- it covers **named NPCs in `game/content/npcs.ts`** — characters deliberately
  established with a stable identity, authored dialogue, and a place in the
  world. It does not cover items, actions, mechanics, Local Places, merchants,
  repair targets, or any other registry entry, each of which still belongs in
  the most relevant existing article. Missions have their own guides, under
  the exception above;
- a character page is written from the `Public-Wiki-safe facts` on that NPC's
  page in the Notion Canon (linked from `docs/npc-canon.md`) and from nothing
  else. The Canon is **internal and spoiler-complete**, and must never be copied
  from wholesale;
- a character with little player-safe canon gets a short, truthful page. Do not
  pad one with invented biography, and do not open an empty page for a character
  who has not shipped.

Internal-only CI/test/refactor/architecture work does not require a Wiki
update unless it changes actual player-visible behavior.
