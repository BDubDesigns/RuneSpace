# Holo Film Studio

The Holo Film Studio is the silent-film authoring, animation, preview, and
visual-QA system for the Holo Drive-In. It lives at `tools/holo-film-studio/`
and is an **independently operated development tool**. Unlike QC Studio, which
the app serves at `/qc-studio`, it is not part of the Next.js app: it has no routes, no React, no database, and no
dependencies. Adopted in issue #489; before that it was a standalone project at
`/home/brandon/claude/runespace-movies`.

This document is the RuneSpace-side contract. The studio's own docs live beside
the code and are written to stand alone: start with
`tools/holo-film-studio/NEXT_FILM_HANDOFF.md` (status, next steps, open
decisions), then `tools/holo-film-studio/MOVIE_AUTHORING_GUIDE.md`
(architecture, authoring, testing, visual QA). `tools/holo-film-studio/README.md`
has setup, the public player API, and packaging.

## What it is, and what it is not

- Zero-dependency ES modules, SVG, the Web Animations API, and three
  stylesheets: its own seekable timeline engine and player, film registry,
  character rigs, effects, deterministic playback, reduced-motion behavior,
  `node:test` suites, a headless-Chrome verification harness, and timestamped
  contact-sheet QA tooling.
- Two films: **That Mines Mine!** (1:43, approved) and **Rare or Weld Done?**
  (about 3:01, 37 scenes, awaiting final owner approval).
- It is **not** the Drive-In or Theatre feature. Theatre gameplay, tickets,
  Mining or Welding buffs, showtime scheduling, the Drive-In world location, new
  films, and commercials are separate product work that needs its own issues.
  Mounting a film in the game would consume the studio's public player API
  (`tools/holo-film-studio/README.md` §5 and §8) from a future feature; nothing
  in the game does so today.
- It is not merged with QC Studio and its engine is not rewritten around React.

## Run it

Everything runs from the studio directory. No `pnpm install`, no PostgreSQL, no
`DATABASE_URL`, and no managed-host wrapper are needed.

```bash
cd tools/holo-film-studio
npm test             # structure, engine, docs, film-one pin, film-two story (~1 s, Node only)
npm run verify       # real engine in headless Chrome, every film (~100 s; needs Chrome/Chromium)
npm run pack:check   # what `npm pack` would ship
npm run dev          # http://127.0.0.1:5173/?film=<id> preview
npm run shoot -- <film> <out-prefix> <ms | scene+ms | every:ms> ...   # stills and contact sheets
```

`npm run verify` needs Node 22 and a Chrome or Chromium (`CHROME_BIN=/path` if it
is not on `PATH`); set `VERIFY_NO_SANDBOX=1` where the browser sandbox is
unavailable, as CI does. Real playback needs a visible page.

## Boundaries (what keeps it independent)

| Boundary | How it is held |
| --- | --- |
| Not shipped to players | Nothing in `app/`, `components/`, `features/`, `game/`, `server/`, `db/`, `minigames/`, or `tools/qc-studio/` references it, so Next.js never bundles it. `.dockerignore` keeps it out of the production image's build context. |
| No dependencies | Its `package.json` is `private` with no dependency fields; its source imports only its own files and Node built-ins. There is no `pnpm-workspace.yaml`, so the nested package is invisible to `pnpm install` and `pnpm-lock.yaml`. |
| Source kept as authored | `.prettierignore` and the ESLint ignore list exclude it. Do not run Prettier over it: its formatting is its own, and the approved film's pinned output must not be perturbed. `tsconfig.json` includes only `.ts` files with `allowJs: false`, so only `src/index.d.ts` is seen by `tsc` (and `skipLibCheck` skips declaration bodies). |
| Own test runner | Its tests are `node:test` files run by `npm test`; Vitest's `tests/unit/**` include does not pick them up and Playwright never loads them. |
| Guarded | `tests/unit/holo-film-studio-boundary.test.ts` fails if the studio gains a dependency, imports outside itself, is imported by shipped code, drops out of the Prettier, ESLint, or Docker ignores, or loses its CI lane. |

## CI

The `Holo Film Studio (test, verify, pack)` lane (job id `holo-film-studio`) in
`.github/workflows/ci.yml` runs `npm test`, `npm run verify`, and
`npm run pack:check` in `tools/holo-film-studio/` on a plain Node 22 runner. Like
every other lane it starts with each PR push, needs no other lane, and is one of
the lanes `Merge gate` requires (`scripts/ci-merge-gate.mjs`, covered by
`tests/unit/ci-gate-policy.test.ts`). It is deliberately **not** part of the
canonical gameplay E2E and does not touch PostgreSQL or the managed-host
wrapper. A red studio lane is a real failure: read the job log, reproduce only
the failing studio check locally, fix, and push.

## Provenance and the film-one approval reference

The studio was a standalone Git repository (`main`, 13 commits, no remote). It
was imported with `git subtree add` (without `--squash`), so every original
commit is part of RuneSpace's history **with its original SHA**:

| Reference | Value |
| --- | --- |
| Imported standalone head | `9ce0ddf04bfa4cfaf421c828da47db8d5c5ba630` (the import commit's `git-subtree-split` trailer) |
| Film one approved (formerly tag `film1-approved`) | `e90a091c8f8460e1fad4b5acb3c4fd1b8b9d14e3`, "Baseline: That Mines Mine! as approved" |
| Film one build output pinned to that commit | duration `103400` ms; `sha256(JSON)[:16]` of markup `d2ce8eaa1ae8a6d6`, cues `3c2332c3c862e9cc`, chapters `bcc616fbe97ca9d3` (`tools/holo-film-studio/test/film1-approved.test.mjs`) |
| Film two | built, in owner review, **no approval record and no `film2-approved` tag**; 37 scenes, 181300 ms |

The import added the studio tree byte-for-byte: the imported
`tools/holo-film-studio` tree object equals the standalone `9ce0ddf` root tree
(`git rev-parse <import-commit>:tools/holo-film-studio` equals
`git rev-parse 9ce0ddf^{tree}`); the commits after it change only the studio's three
documents and RuneSpace's own CI, ignore files, tests, and docs. The
standalone `.git` directory was not copied. The original directory is kept
intact as an archive until the import PR has merged **with a merge commit** and
GitHub contains the source. A squash or rebase merge would drop the original
commits from `main`; if that is chosen, keep the archive.

Verify the film-one reference from the RuneSpace root:

```bash
git cat-file -t e90a091                       # commit
git merge-base --is-ancestor e90a091 HEAD && echo reachable
git archive e90a091 | tar -x -C "$(mktemp -d)" # the approved tree, to hash independently
cd tools/holo-film-studio && node --test test/film1-approved.test.mjs
```

Hashing `src/films/that-mines-mine/index.js`'s `build()` output from the
extracted approved tree and from the current tree gives the same values as the
pin above. If a shared-engine change ever alters the approved picture, the pin
test fails; do not update the hashes without the owner re-approving film one.

## Changing the studio

Treat it as the owner-approved system it is: work from an issue and a fresh
branch per `AGENTS.md`, keep each PR to one bounded change, do not alter either
film unless the issue says so, run `npm test`, `npm run verify`, and
`npm run pack:check` before pushing, and never create an approval record for
film two without the owner's explicit approval. Updating the project's docs
(`README.md`, `NEXT_FILM_HANDOFF.md`, `MOVIE_AUTHORING_GUIDE.md`) is part of the
change; its docs test fails when a named path or script goes stale.
