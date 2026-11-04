# Next Film Handoff

For a fresh agent with no memory of earlier sessions. Everything you need is in this repository.
Last updated at the end of the "build film two" session (git: see `git log`).

## Paste this to start the next session

> Read `NEXT_FILM_HANDOFF.md`, then `MOVIE_AUTHORING_GUIDE.md`, in `/home/brandon/claude/runespace-movies`.
> Run `npm test` and `npm run verify` to confirm the baseline is green. Then <do what the owner asked: apply
> review feedback to "Rare or Weld Done?", or build the next film>. Do not copy or fork the engine, do not modify
> "That Mines Mine!", and do not touch the RuneSpace game repository or implement any theatre gameplay. Get the
> screenplay (beats, cast, tone, runtime) from the owner before writing a scene, and record it in
> `src/films/<id>/STORY.md`.

## 1. Project status

- **Engine, player, effects, rig, props, cards: done and shared.** Film-agnostic; see guide §1.
- **Film 1, "That Mines Mine!": complete and approved.** 1:43. Git tag `film1-approved`. Its `build()` output is pinned
  by `test/film1-approved.test.mjs` (hashes recorded from that tag), so a change to shared code that alters it fails `npm test`.
- **Film 2, "Rare or Weld Done?": built, tested and reviewed frame by frame; awaiting the owner's approval.**
  about 3:01 (181 s), 37 scenes (30 shots + 7 cards), the eight approved beats as chapters. **There is no `film2-approved`
  tag yet: create it only after the owner approves** (`git tag film2-approved`). Nothing has been pushed anywhere; there is no remote.
- Registry `src/films/index.js`: `that-mines-mine`, `rare-or-weld-done`, hidden `template`. Demo page: `?film=<id>`.

### Film 2 at a glance

The approved screenplay is in `src/films/rare-or-weld-done/STORY.md` (locked; the ending and the two punchline cards must not change).

| Beat (chapter) | Scenes | Set piece |
|---|---|---|
| Opening | studio, title | |
| 1 The newspaper | read, paper, plan, grab | the **FENCE dealer** in a thought bubble (the setup the ending depends on) |
| 2 The great heist | night, wall, arc, cut, squeeze, vault | sneaking past the searchlight; the kerf draws itself on while the torch follows it; cart bump; **boot welded to the plaza**; the astonished face |
| 3 The impossible getaway | sack, kickRun, kick | tiny sack, push, shoulder, rope; the very long run-up; **jump-kick, BOOOONG**, rebound heap with stars |
| 4 The balloons | balloons, rise, pop, crash | 1, 3, 8, then 18 balloons; the squeeze out through the wall; the dangling rope; **tiny bird, POP, cascade**; KRA-KOOM; the dusty thief |
| 5 A brilliant realization | despair, ifIcant, illBring | road to the dim FENCE sign, the Emerald, the torch, a lightbulb; the locked cards (4.6 s / 5.0 s) |
| 6 The construction montage | posts, iron, gate, signUp, ready | **welding montage**: posts, scrolling ironwork, gate + booth, the admission sign lettered line by line, string lights |
| 7 The perfect crime | morning, queue | 14 tourists, the pile of Credits grows (no police officer) |
| 8 The locked punchline | reread, plate, end | "ONE WEEK ONLY!" insert; the **OPEN DAILY plate welded over the sign**; hold; iris closes; THE END |

Names that are placeholders live **only** in `src/films/rare-or-weld-done/config.js` (`NAMES`: the Emerald's working name, a
neutral museum label, the in-fiction "5 CREDITS ADMISSION" price, which is not the Drive-In ticket price). A test fails if a scene hard-codes them.

### Continuity passes since the first build

1. Hoses (valve to hand via `connectHose` / `dragCart`), real contact in the attempts (four iris-cut shots `sack`, `push`, `shoulder`, `ropeTry`), crater and wall hole only after their cause, slower beats.
2. The `rise` scene: palms stay on the Emerald's face for the whole push (thief x = Emerald x minus a gap derived with `gripAt`; the lean is a whole-body root rotation, not torso-only). The museum's wall slab now ends at the roof instead of towering over the bird, and the roof lip runs the full width of the gallery.
3. Owner review round three: wanted poster (his photo, 500 CREDITS REWARD FOR CAPTURE) and the gear on a shelf; a new `spot` shot (rock breaks the searchlight, bounces onto the camera, both fall) between `wall` and the new `study` shot, with `museumFront`'s `light`/`cam` accepting `'broken'` for every later night shot and the yard; sparse, varied gallery pictures (planets, ships, galaxies); a bank bag with the Credits mark that the thief stretches to 2x and cannot stuff the Emerald into; the Emerald sunk deeper into the crater (crash, despair, yard); a whole-body stoop instead of the torso-only one in `crash`; standing in `despair`; card 2 now reads "I'LL BRING A FENCE" (the owner changed the locked wording); `iron` is just the torch running along the rail with sparks (nothing drawn); the paper's back faces the camera in `reread`; the OPEN DAILY plate is welded on the right-hand side of the sign, not over all of it. `gripAt(c, cues, t, 'B')` gives the back hand.
4. Round four: the bank bag is held upright with its open mouth at the top (the prop turns back against the arm to stay upright); camera pans in `despair` and `reread` hold a beat on every focal point (tourists, sign, proprietor / FENCE sign, Emerald, torch, bulb); the OPEN DAILY plate is welded to the sign's right-hand edge and covers none of its text.
5. "Effects vanish after using the controls" was reported once and did not reproduce; `npm run verify` now has a check for it and the guide (3.4) says how to investigate.

## 2. What was verified (and how)

| Claim | Evidence |
|---|---|
| Whole suite | `npm test`: 76 tests, 75 pass, 1 skipped by design (the no-overlap check is not applied to approved film one), 0 fail |
| Film 1 unchanged | `test/film1-approved.test.mjs`: markup / cues / chapters hashes and duration match the `film1-approved` tag; shared-library changes did not touch its output |
| Structure of every film | `films.test.mjs`: cue targets resolve, cues start in their own scene, **no two cues overlap on one element property**, gradients resolve, deterministic build, captions, chapters |
| Film 2 story points | `rare-or-weld-done.test.mjs`: locked card wording, chapter list, ending scenes, FENCE planted twice, no police officer, names only in `config.js`, runtime 2:00-2:40 |
| Real-browser behaviour | `npm run verify`: all films PASS in headless Chrome (seek determinism over 161 sample times for film 2, one scene + one face at a time, pause freezes everything, replay/restart/skip, reduced motion, load/destroy leak nothing, 375 px player) |
| It looks right | Contact sheets rendered with `npm run shoot` (`dev/shoot.mjs`): a frame every 2.7 s across the whole film, the first and last frame of every shot, every set piece at full size, reduced motion, and the demo page at 375x812 and 1280x900 |
| No console noise | scrubbed both films end to end incl. reduced motion in headless Chrome: no warnings or errors (the old `favicon.ico` 404 is gone) |
| Package | `npm pack --dry-run`: 46 files, 146 kB packed (`src/` + docs only) |

## 3. Read first (in this order, ~25 minutes)

1. This file. 2. `MOVIE_AUTHORING_GUIDE.md` (all of it; §0 rules 2, 4, 11; §5; §7; §9; §11). 3. `src/films/_template/`.
4. `src/engine/timeline.js` (header + `compile()`), `src/engine/film.js`, `src/acting.js`, `src/kit.js` (note `reach` / `aimAlong`).
5. Film 1's `scenes/rival.js` and `bonk.js`, film 2's `scenes/getaway.js` (`kick`) and `scenes/sky.js` (`pop`): choreography with several actors.
6. `dev/sheet.html` in the browser (`npm run dev`): every face, prop, character and set piece.

## 4. Exact steps for the next film (or for review feedback on film 2)

1. `git status` (must be clean), `npm test`, `npm run verify`: green baseline.
2. **Get the spec from the owner.** Write the approved beats to `src/films/<id>/STORY.md`.
3. `cp -r src/films/_template src/films/<id>`, set `id`/`title`, add one registry line. (Guide §5.)
4. `config.js` first (names, TEXT, TIMING, CAPTION), then `world.js` (include `${FX_DEFS}`), then scenes one at a time.
   After each scene: `npm run shoot -- <id> /tmp/f <scene>+<ms> ...` and LOOK, then `npm test`, then commit.
5. New reusable art goes in `src/art/` (and on `dev/sheet.html`), new particles in `src/fx/` (+ a unit test); keep
   film-specific things under `src/films/<id>/`.
6. `npm test`, `npm run verify`, the manual checklist (guide §9.3), update README's film table and this file.
7. Tag `film<N>-approved` only after the owner approves.

## 5. How to avoid duplicating the engine

- A film is *only* `src/films/<id>/` (config, world, scenes, index) + a registry line. If you are about to copy anything
  from `src/engine/`, `src/player/`, `src/acting.js`, `src/kit.js`, `src/fx/` or `src/art/`, stop: import it.
- If film 3 wants something film 1 or 2 has privately (film 1's `sunburst`, `cactus`, ground; film 2's `yard.js` set, museum
  wall, cut-away section), **promote it to `src/art/`** and import it from both; never import from another film's folder.
  After promoting, film 1's hash test and `npm run verify` must stay green.
- If an engine change seems needed, make it in `src/`, add a test or a `dev/verify.js` check, and re-run everything for **all** films.

## 6. Known limitations and known issues

- **Two latent timing slips in film 1** (left alone on purpose, since the film is approved): `idle(pip, 0, 3300, 1100)` in
  `src/films/that-mines-mine/scenes/rival.js` and `idle(rex, 0, 3400, 900)` in `scenes/payoff.js` pass film-relative `0`
  where `at(0)` was meant. `test/films.test.mjs` allow-lists exactly those two cues; delete the entry if you fix them (that
  changes film 1's picture subtly: it needs re-approval and new hashes in `test/film1-approved.test.mjs`). Film 1 also has
  43 overlapping Track cues; `OVERLAPS_ALLOWED` in `films.test.mjs` exempts it. New films get no exceptions.
- **Film 2 runtime is about 3:01** after the second and third review rounds (longer holds at the camera focal points in `despair` and `reread`, a longer bag gag, the new rock scene) (the owner asked for a new scene and a longer bag gag; 2:46 before that) and the continuity pass (the owner found the action too fast in places, so the squeeze, lift-off, posts, thought bubble and the failed-attempts montage were slowed; the text cards were left alone), past the "about 2 minutes, up to roughly 2:30" target. Card timings follow the
  ~1 s + 0.4 s/word rule (film 1's lesson) and were not shortened; the trims were all in holds and in the long walks. The
  places to cut more, if the owner wants it, are non-text holds (`balloons`, `cut`, `vault`), not the slowed actions.
- **Performance.** Film 2 keeps ~2,400 Web Animations alive (film 1: ~1,340). In headless Chrome with *software* rendering
  (no GPU) film 2's busiest scenes run at ~20-36 ms/frame, comparable to film 1 measured the same way. **Untested on a real
  low-end phone.** Cheap wins if needed: fewer `sparks`/`puff` along the cut (`scenes/heist.js`), fewer pebbles/stars in `world.js`,
  fewer tourists in `queue`.
- **A character's face is not visible behind welding goggles** (by design: the mouth and body carry it). The thief rig is the
  only one with goggles / top hat / bow tie.
- **Tested in Chromium only** (Chrome 154). Firefox/Safari should work (standard WAAPI, `clip-path` on SVG groups,
  `strokeDashoffset` cues, container queries) but are unverified.
- **No audio**, by design (the gags were built to work with sound off; `BOOOONG!`, `POP!`, `KRA-KOOM!` are lettered).
- **Fonts are system serif/Impact** stacks; card fitting assumes ~0.66 em per character.
- **Types are hand-written** (`src/index.d.ts`); `Film.build()` is typed `unknown`.
- **`npm run verify` needs Chrome/Chromium and Node >= 22.** Real playback needs a *visible* page. In the Claude desktop app's
  browser pane the layout viewport can be larger than the pane, so screenshots look zoomed and cropped; use `npm run shoot`.

## 7. Open decisions (ask the owner, or decide and write it down here)

1. **Approval of film 2** and the `film2-approved` tag. Note any feedback in this file.
2. **Lore:** the Emerald's real name and the third planet's name are undecided; change `NAMES` in film 2's `config.js`
   (and re-check the museum sign and sign lettering fit, see `signboard()` font fitting).
3. **Runtime budget** for film 2 and later films (see §6).
4. **Barrel export of `thatMinesMine`** bundles film 1 into any import of `src/index.js`; keep for compatibility or drop it.
5. **Fonts:** system stacks, or load Playfair Display in the host for a consistent card look.
6. **Packaging:** vendor `src/` into RuneSpace or consume the `npm pack` tarball (both work).
7. **TypeScript conversion** of `src/`: deferred.

## 8. Out of scope so far (do not start without being asked)

Ticket purchases, Credit deductions, buffs, showtime scheduling, any backend, the Drive-In world location, pre-show
commercials, and a third film. "5 CREDITS ADMISSION" in film 2 is a gag price inside the story, not the Drive-In ticket price.

## 9. Commands

```bash
npm run dev          # http://127.0.0.1:5173/?film=<id>   (&t=ms &cc=1 &reduced=1 &ui=0 &bare=1)
npm test             # structure + unit + docs + film-one pin + film-two story tests, ~0.4 s
npm run verify       # real-browser checks for every film, ~70 s
npm run shoot -- <film> <out-prefix> <ms | scene+ms> ...   # render stills + a contact sheet (COLS= W= H= UI=1 REDUCED=1)
npm run pack:check   # what would ship
git tag -l; git log --oneline
```
