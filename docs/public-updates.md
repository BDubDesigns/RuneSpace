# Public Updates

RuneSpace Updates are repository-authored player-facing release entries. The
same validated entry supplies the `/updates` index, the `/updates/[slug]`
article page, and the latest-Update projection on the homepage. This is a
narrow publishing path, not a CMS or a general content platform.

## Add an Update

Add one object to `authoredUpdates` in
`features/public-site/public-updates.ts`. Keep the article prose and its patch
notes in that same object so they cannot drift into separate release systems.
The schema in `game/schemas/public-updates.ts` validates the collection when it
is imported during the build.

Every object requires:

- `slug`: a stable lowercase kebab-case route segment. It becomes
  `/updates/<slug>`; do not change it after publication.
- `title`: the player-facing article title.
- `publishedAt`: an ISO-8601 timestamp with an explicit timezone, such as
  `2026-09-07T12:00:00-07:00` or `2026-09-07T19:00:00Z`. Ordering is derived
  from this field, never from array order, filesystem timestamps, Git dates, or
  the current clock. Its parsed instant must be unique across every authored
  Update — two Updates cannot publish at the same instant, even when spelled
  with different UTC offsets — because the account-level news read-through
  boundary (issue #156) identifies "the newest published Update" by this same
  instant and cannot distinguish two Updates that share one.
- `summary`: the short excerpt shown on the index and homepage.
- `body`: an ordered array of prose paragraphs and optional figure blocks. A
  paragraph may instead be an array of text and Wiki link segments (`{ text, articleSlug }`, the same
  shape and rules as the Wiki's, see `docs/public-wiki.md`) when an Update
  should link a phrase to a Wiki article such as the Community Rules; every
  `articleSlug` must be a real authored Wiki article.
- `patchNotes`: an ordered array of sections, each with a `heading` such as
  `Added`, `Changed`, or `Fixed`, and one or more player-facing `items`.

An optional `hero` may reference a committed image under `public/landing/`,
`public/location-scenes/`, or `public/updates/`. Reference the artwork's real
runtime home: existing game scenery stays in `public/location-scenes/` and
landing-owned art stays in `public/landing/`. `public/updates/` is only for art
whose canonical purpose is the Update itself. Never copy existing game art
there just to publish it. Supply the public path, descriptive `alt`, and real
intrinsic `width` and `height`. Reference only approved runtime files, never
source masters, remote URLs, or images produced at build/request time.

### Inline item and NPC figures

Place each figure immediately before the prose it accompanies; multiple figures
are allowed in body order. Existing plain and linked paragraphs remain valid.

```ts
body: [
  { kind: "figure", art: { kind: "item", itemId: ITEM_IDS.uncutTopaz }, side: "right" },
  "The prose that belongs beside the gem...",
  { kind: "figure", art: { kind: "npc", npcId: NPC_IDS.curly }, side: "left" },
  "The prose that belongs beside the portrait...",
]
```

An NPC reference may include `expressionId`; omission selects the canonical
neutral expression. `caption` is optional on the figure and defaults to the
canonical display name. Do not supply `src` or alt text: `resolveArticleArt` in
`game/content/article-art.ts` resolves item artwork/name/accessibility from
`item-presentation.ts` and NPC identity/role/expression from `npcs.ts`.
Unknown references, missing item artwork, and missing NPC expression artwork
fail collection validation during import/build. Arbitrary image paths and
other art kinds are not supported.

Figures retain the full artwork with its intrinsic shape. At 640px and wider,
prose wraps around the rectangular frame on the authored side; each new figure
clears the preceding one. On phones figures stack centered before their prose,
capped at 14rem for items and 12rem for NPCs. The article body contains its
floats, so Patch Notes always start below them. Figures appear only in articles;
index cards, homepage Latest Update and account News stay summary-only. The
Wiki schema and renderer do not support figures in this slice.

### Hero image policy

- A player-facing Update should normally ship with a hero when the release has
  a strong, already-available visual asset that materially represents the
  feature or milestone — for example the approved scene for a new location.
- Do not omit an obvious relevant hero merely because `hero` is optional in the
  schema. Optional means "not every Update has one", not "leave it out".
- A hero is not mandatory. When no suitable existing image exists, publish the
  Update without one; missing art never blocks an otherwise appropriate
  Update, and authors must not invent or generate decorative filler art merely
  to satisfy this convention.
- Prefer repo-local committed assets and public paths, and keep the schema's
  requirements: accurate, descriptive `alt` text and the image's real intrinsic
  `width` and `height`.
- The article model supports one wide hero plus ordered inline item/NPC
  figures. Item and portrait art belongs in a figure rather than a wide banner.

`docs/art-cookbook.md` owns the visual-production rule for choosing, generating,
and reviewing hero art. This document owns the publishing contract and
public-site path rules.

The collection rejects duplicate slugs, duplicate `publishedAt` instants,
missing required fields, malformed timestamps, and invalid image references.
`getPublishedUpdates()` returns the
validated collection sorted newest-first by `publishedAt`; ties use the stable
slug as a deterministic secondary order. `getLatestPublishedUpdate()` is the
homepage projection, so homepage code must not special-case an article.

## Publication and maintenance rules

There is no draft, scheduled, embargo, or CMS state in this content model. An
Update on a feature branch or Draft PR is not published. Merging the PR to
`main` is the publication boundary for this pre-alpha workflow.

When a later player-facing milestone warrants an Update, add a new entry. Do
not rewrite an already-published entry to describe unrelated later changes.
Internal-only CI, test, refactor, documentation, dependency, and maintenance
work generally does not warrant an Update unless it has meaningful player
impact worth communicating.
