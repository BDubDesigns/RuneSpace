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
- `body`: an ordered array of prose paragraphs.
- `patchNotes`: an ordered array of sections, each with a `heading` such as
  `Added`, `Changed`, or `Fixed`, and one or more player-facing `items`.

An optional `hero` may reference a committed image under `public/landing/` or
`public/updates/`. Store new Update-specific images in `public/updates/` and
reference them with the public path, for example
`/updates/repair-complete.webp`, plus its real `alt`, `width`, and `height`.
Reference only committed, repository-local, approved image files. RuneSpace
intentionally uses AI-generated artwork, and approved generated art is welcome
once it is committed; the boundary is stability, not provenance. Do not
reference source-only or master assets, remote or external URLs, or images
produced at build or request time. When the
art already ships elsewhere in the repository (for example a location scene),
commit a copy of that same approved file under `public/updates/` rather than
widening the allowed paths.

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
- The article model supports one hero only. Secondary inline article images are
  not part of this contract; do not add them without an approved change to the
  schema and renderer.

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
