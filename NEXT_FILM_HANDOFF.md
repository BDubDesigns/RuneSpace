# Next Film Handoff

For a fresh agent with no memory of earlier sessions. Everything you need is in this repository.
Last updated at the end of the "preserve and prepare the project" session (git: see `git log`).

## Paste this to start the next session

> Read `NEXT_FILM_HANDOFF.md`, then `MOVIE_AUTHORING_GUIDE.md`, in `/home/brandon/claude/runespace-movies`.
> Run `npm test` and `npm run verify` to confirm the baseline is green. Then build the second film,
> **"Rare or Weld Done?"**, as a new film under `src/films/` using the existing engine, player and shared
> libraries. Do not copy or fork the engine, do not modify "That Mines Mine!", and do not touch the RuneSpace
> game repository or implement any theatre gameplay. Before writing any scene, ask me for the story beats,
> cast, tone and target runtime, and record the approved beats in `src/films/rare-or-weld-done/STORY.md`.

## 1. Project status

- **Engine, player, effects, rig, props, cards: done and shared.** Film-agnostic; see guide §1.
- **Film 1, "That Mines Mine!": complete and visually approved.** 1:43, 27 scenes, 8 story beats as chapters.
  Git tag `film1-approved` marks the approved state; after the multi-film work its `build()` output
  (markup, cues, chapters, duration) was proven byte-identical to the tag.
- **Multi-film support: in place.** Registry `src/films/index.js` (`FILMS`, `listFilms`, `loadFilm`); the demo page
  selects a film with `?film=<id>`; a tested starter film lives in `src/films/_template/`.
- **Film 2 "Rare or Weld Done?": not started** (by instruction). There is no spec for it yet.
- Repository: git, branch `main`, no remote. No dependencies, nothing generated is tracked.

## 2. What was completed and verified (and how)

| Claim | Evidence |
|---|---|
| Film 1 unchanged by the refactor | `film.build()` sha256 of markup, cues and chapters identical before/after; duration 103,400 ms |
| Structure of every registered film | `npm test`: 46 tests (cue targets resolve, cues start in their own scene, gradients resolve, deterministic build, captions, chapters, docs paths) |
| Real-browser behaviour, both films | `npm run verify` (headless Chrome 154): seek determinism over ~136 times, one scene + one face visible, pause freezes everything, replay/restart/skip, reduced motion, `load()`/`destroy()` leak nothing, 375 px player |
| Film 1 plays and looks right | Played from the start in the app browser; frames at title, argument zoom, late chase; 375×812 mobile layout; template film renders |
| Package is clean | `npm pack --dry-run`: 29 files, 60 kB, `src/` + docs only |

Defects found and fixed *while* preparing multi-film support (they would have hit film 2):

1. `timeline.destroy()` cancelled the player chrome's own CSS animations, so after any second `player.load()`
   the grain, flicker, scratches, vignette breathing and gate weave were dead for good. Fixed in `src/engine/timeline.js`.
2. The player's mobile layout keyed off the *window* width (`@media`), so a narrow panel in a wide window overflowed.
   Now a container query on the player (`src/player/player.css`).
3. Reusable `puff`/`dust` needed `#g-dust` that only film 1's `world.js` defined. Now `FX_DEFS` in `src/fx/effects.js`.
4. `Camera`, `blow`, `popIn`, `idle`, `fwd`, `driftClouds` and the `titleCard`/`shot` helpers lived inside film 1's folder;
   now `src/kit.js` (`filmHelpers`).

## 3. Read first (in this order, ~20 minutes)

1. This file. 2. `MOVIE_AUTHORING_GUIDE.md` (all of it; §5, §7, §9, §11 twice). 3. `src/films/_template/` (4 small files).
4. `src/engine/timeline.js` (header comment + `compile()`), `src/engine/film.js`.
5. `src/films/that-mines-mine/scenes/rival.js` and `bonk.js`: the best examples of multi-character choreography and gags.
6. `src/films/that-mines-mine/config.js` and `index.js`: text, timing, transitions, chapters.
7. `dev/sheet.html` in the browser (`npm run dev`): the available faces, props, characters.

## 4. Exact steps for the next film

1. `git status` (must be clean), `npm test`, `npm run verify`: confirm a green baseline.
2. **Get the spec from the user** (the first film had 8 locked story beats and hard constraints). At minimum: beats in
   order, cast, the gags that must land, the title cards' wording, target runtime. Write the approved list to
   `src/films/rare-or-weld-done/STORY.md` so it never lives only in chat.
3. `cp -r src/films/_template src/films/rare-or-weld-done`; set `id: 'rare-or-weld-done'`, `title: 'Rare or Weld Done?'`;
   add one registry line in `src/films/index.js`. (Guide §5.)
4. Write `config.js` first (TEXT, TIMING, CAPTION for every scene), then `world.js` (include `${FX_DEFS}`), then scenes one at
   a time. After **each** scene: `?film=rare-or-weld-done&t=<scene start>`, `npm test`, commit.
5. New reusable art (a welding torch, a new cast member, a "rare ore") goes in `src/art/` and on `dev/sheet.html`, not in the
   film folder, unless it is truly single-use. New particles go in `src/fx/effects.js` + `effects.css`.
6. Verify: `npm test`, `npm run verify`, then the manual checklist (guide §9.3): scrub every scene, replay, pause/resume,
   mobile 375×812, reduced motion, read every card.
7. Update `README.md`'s film table and this file's status; commit. `git tag film2-approved` once the user approves it.

## 5. How to avoid duplicating the engine

- A film is *only* `src/films/<id>/` (config, world, scenes, index) + a registry line. If you are about to copy anything
  from `src/engine/`, `src/player/`, `src/acting.js`, `src/kit.js`, `src/fx/` or `src/art/`, stop: import it.
- If film 2 needs something film 1 has privately (`sunburst`, `cactus`, a sky, a ground), **promote it to `src/art/`** and
  import it from both films; never import from `films/that-mines-mine/`. After promoting, film 1's `build()` output must be unchanged.
- If an engine change seems needed, make it in `src/`, add a test or a `dev/verify.js` check, and re-run everything for **both** films.

## 6. Known limitations and known issues

- **Two latent timing slips in film 1** (left alone on purpose, since the film is approved): `idle(pip, 0, 3300, 1100)` in
  `src/films/that-mines-mine/scenes/rival.js` and `idle(rex, 0, 3400, 900)` in `scenes/payoff.js` pass film-relative `0`
  where `at(0)` was meant. The breathing sway therefore runs during the opening card instead of in those scenes (the
  sleeping Pip and the idle Rex are slightly stiller than intended). Fixing means adding `at(...)` to both calls, which
  changes the picture subtly and needs re-approval. `test/films.test.mjs` allow-lists exactly these two cues; delete the
  allow-list entry if you fix them. New films get no exceptions.
- **Tested in Chromium only** (Chrome 154). Firefox/Safari untested; they should work (standard WAAPI + container queries).
- **No audio**, by design. Frame/video export is documented in the README but not exercised by tests.
- **Rig is two characters.** `prospector()` has `pip` and `rex`; a third body means extending an `if (kind === 'pip')`
  branch or writing a new rig (guide §6.1).
- **Fonts are system serif/Impact** stacks, nothing is bundled; card fitting (`fit()`) assumes ~0.66 em per character.
- **Types are hand-written** (`src/index.d.ts`); `Film.build()` is typed `unknown`.
- **Film 1 is 1:43**, longer than the original 45–90 s brief (title cards were lengthened at the user's request). Ask
  for film 2's runtime budget up front.
- **`npm run verify` needs Chrome/Chromium and Node ≥ 22.** Real playback needs a *visible* page (a hidden pane freezes the clock).
- Performance on low-end phones is untested beyond emulation (~1,350 animations for film 1).

## 7. Unresolved technical decisions (ask the user, or decide and write it down here)

1. **Barrel export of `thatMinesMine`.** It makes `import '…/src'` bundle film 1. Keep for compatibility, or drop it and
   make `loadFilm()` the only film entry point when integrating into RuneSpace.
2. **Cast for "Rare or Weld Done?"**: reuse pip/rex with new props, add a third `kind`, or a new rig? (Depends on the story.)
3. **Where shared world art lives** once two films want it (recommendation: `src/art/`, as above).
4. **Fonts:** keep system stacks, or load Playfair Display in the host for a consistent card look.
5. **Runtime and card timing policy** for film 2 (film 1's rule of thumb: ~1 s + 0.4 s per word).
6. **Packaging:** vendor `src/` into RuneSpace, or consume the `npm pack` tarball. (Both work; pick when integrating.)
7. **TypeScript conversion** of `src/`: deferred; worth doing only if the host wants type-checked film authoring.

## 8. Ideas noted earlier for the title (suggestions, not decisions)

A welder prop (torch with a flickering glint and a `sparks()` fountain, `#g-glow` for the arc), a "rare ore" prop with a slow
shimmer, a tool-swap gag via the `propF` track, a welded-shut mine door as a location, and a hard-cut pun structure for the
title ("rare" vs "weld done"). The film-1 cutter can reappear as a recurring tool.

## 9. Commands

```bash
npm run dev          # http://127.0.0.1:5173/?film=<id>   (&t=ms &cc=1 &reduced=1 &ui=0 &bare=1)
npm test             # structure + unit + docs tests, ~0.3 s
npm run verify       # real-browser checks for every film, ~20 s
npm run pack:check   # what would ship
git tag -l; git log --oneline
```
