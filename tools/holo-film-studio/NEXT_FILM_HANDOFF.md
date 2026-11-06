# Next Film Handoff

For a fresh agent with no memory of earlier sessions. Everything you need is in this repository.
Last updated when the project was imported into RuneSpace (issue #489); film two's content is unchanged since the last review round (see `git log -- tools/holo-film-studio`).
**This project lives in the RuneSpace repository at `tools/holo-film-studio/`.** Run every `npm` command here from that directory; the RuneSpace-wide rules
(root `AGENTS.md`, issue/branch/PR workflow, CI) apply to any change, and `docs/holo-film-studio.md` explains the boundaries.

## Paste this to start the next session

> Read RuneSpace's `AGENTS.md` and `docs/holo-film-studio.md`, then `tools/holo-film-studio/NEXT_FILM_HANDOFF.md`, then `tools/holo-film-studio/MOVIE_AUTHORING_GUIDE.md`,
> in the RuneSpace repository (work from `tools/holo-film-studio/`; the old standalone `/home/brandon/claude/runespace-movies` is an archive, do not edit it).
> Read guide section 9.5 (visual QA) and section 13 (lessons from film two) before touching a scene.
> Run `npm test` and `npm run verify` to confirm the baseline is green. Then <do what the owner asked: apply
> review feedback to "Rare or Weld Done?", or build the next film or advertisement>. Do not copy or fork the engine, do not modify
> "That Mines Mine!", and do not touch the RuneSpace game code outside `tools/holo-film-studio/` (and the CI/docs that describe it) or implement any theatre gameplay. Get the
> screenplay (beats, cast, tone, runtime) from the owner before writing a scene, and record it in
> `src/films/<id>/STORY.md`.

## 1. Project status

- **Engine, player, effects, rig, props, cards: done and shared.** Film-agnostic; see guide §1.
- **Film 1, "That Mines Mine!": complete and approved.** 1:43. Approval reference: standalone commit `e90a091` (formerly tag `film1-approved`; see README §10). Its `build()` output is pinned
  by `test/film1-approved.test.mjs` (hashes recorded from that commit), so a change to shared code that alters it fails `npm test`.
  Its folder has not changed since the multi-film refactor commit `cfa2acc` (original standalone history, still reachable in RuneSpace) (`git diff cfa2acc -- src/films/that-mines-mine` is empty; that refactor only moved
  shared helpers into `src/` and the pin test proves the output is identical to the approved commit `e90a091`), so none of the film-two work touched it.
- **Film 2, "Rare or Weld Done?": complete; the owner gave final creative approval on November 5, 2026.**
  about 3:01 (181 s), 37 scenes (30 shots + 7 cards), the eight approved beats as chapters. **There is no `film2-approved`
  tag, by the owner's choice.** The approval reference is RuneSpace's subtree import commit `62d2d0484e6101eb3fafe0a255ba1321cc9eaa88`, and the approved
  `build()` output is pinned by `test/film2-approved.test.mjs` (markup, cues, chapters, scene list and duration), exactly as film one's is. The import did not change film two.
- **Commercials (issue #491, Stage D): three 15-second silent spots**, `commercial-dewhat`, `commercial-visit-skatboll`, `commercial-fedhex`, authored for the
  Holo Drive-In's pre-roll from the owner-approved scripts. **The owner approved all three on November 6, 2026** ("DeWHAT?" with the question mark), and `test/commercials-approved.test.mjs` pins their build output and artwork. See the guide, section 14.
- Registry `src/films/index.js`: `that-mines-mine`, `rare-or-weld-done`, the three commercials, hidden `template`. Demo page: `?film=<id>`.

### Film 2 at a glance

The approved screenplay is in `src/films/rare-or-weld-done/STORY.md` (locked; the ending and the two punchline cards must not change,
except that the owner changed card two to "I'LL BRING A FENCE" in review, which is recorded there).

| Beat (chapter) | Scenes | Set piece |
|---|---|---|
| Opening | studio, title | |
| 1 The newspaper | read, paper, plan, grab | the **FENCE dealer** in a thought bubble (the setup the ending depends on); his wanted poster (photo, 500 CREDITS REWARD) and the welding gear on a shelf |
| 2 The great heist | night, wall, **spot**, **study**, arc, cut, squeeze, vault | sneaking past the searchlight; he throws a rock that shatters the lamp, bounces onto the security camera and knocks it off its bracket (both fall; later shots show the wreck); the kerf draws itself on while the torch follows it; cart bump; **boot welded to the plaza**; the astonished face |
| 3 The impossible getaway | sack, push, shoulder, ropeTry, kickRun, kick | four iris-cut attempts (a bank bag with the Credits mark stretched to 2x against the gem's slanted face; push; shoulder charge; rope); the very long run-up; **jump-kick, BOOOONG**, rebound heap with stars |
| 4 The balloons | balloons, rise, pop, crash | 1, 3, 8, then 18 balloons; the squeeze out through the wall; the dangling rope; **tiny bird, POP, cascade**; KRA-KOOM into the crater; the dusty thief |
| 5 A brilliant realization | despair, ifIcant, illBring | standing beside the Emerald, the camera holds on the dim FENCE sign, the Emerald, the torch, a lightbulb; the locked cards |
| 6 The construction montage | posts, iron, gate, signUp, ready | **welding montage**: posts, the torch running along the rail (sparks only), gate + booth, the admission sign lettered line by line, string lights |
| 7 The perfect crime | morning, queue | 14 tourists, the pile of Credits grows (no police officer) |
| 8 The locked punchline | reread, plate, end | "ONE WEEK ONLY!" insert (the paper's back faces the camera); the **OPEN DAILY plate welded to the right-hand edge of the sign, covering none of its text**; hold; iris closes; THE END |

Names that are placeholders live **only** in `src/films/rare-or-weld-done/config.js` (`NAMES`: the Emerald's working name, the
`TORTUGA-9 MUSEUM` label (Tortuga-9 is the approved name of the third planet; the museum has no official name), the in-fiction "5 CREDITS ADMISSION" price, which is not the Drive-In ticket price). A test fails if a scene hard-codes them.

### Review history of film 2 (what changed after the first complete cut)

1. **Visual QA with four Haiku agents** (guide 9.5) plus the owner's own notes: hoses connected valve-to-hand (`connectHose` / `dragCart`), real contact in the
   attempts (now four iris-cut shots), crater and wall opening only after their cause, slower squeeze / lift-off / posts / thought bubble, hands on the newspaper,
   a visible balloon harness, `.fx-late` for effects that showed before their start.
2. **`rise`:** palms stay on the Emerald for the whole push (thief x = Emerald x minus a gap derived with `gripAt`), a whole-body lean instead of a torso-only one; the wall section
   above the museum roof was removed and the roof lip runs the full gallery width.
3. **Review round three:** wanted poster and shelf; the `spot` + `study` shots (and `museumFront` options `light` / `cam` = `'broken'`); sparse varied gallery pictures; the bank bag
   gag; the Emerald sunk deeper into the crater; whole-body stoop in `crash`; standing in `despair`; card two now "I'LL BRING A FENCE"; `iron` is only the torch and sparks;
   the paper's back to camera; the plate beside the sign.
4. **Round four:** the bag is held by its rim with its mouth pressed on the gem's slanted lower-left face; camera pans in `despair` and `reread` hold on each focal point; the plate
   no longer covers sign text.
5. **"Effects vanish after using the controls"** was reported once and did **not** reproduce (a full real-time playthrough plus scrubbing, chapter jumps, skip and replay
   gave frame-identical pictures in headless Chrome and in the desktop app's browser). No engine change was made; `npm run verify` now has a check for it and guide 3.4
   says how to investigate if it returns.

## 2. What was verified (and how)

| Claim | Evidence |
|---|---|
| Whole suite | `npm test`: 76 tests, 75 pass, 1 skipped by design (the no-overlap check is not applied to approved film one), 0 fail (re-run at the end of this documentation pass) |
| Film 1 unchanged | `test/film1-approved.test.mjs`: markup / cues / chapters hashes and duration match the approved commit `e90a091` (formerly tag `film1-approved`); shared-library changes did not touch its output |
| Film 2 unchanged | `test/film2-approved.test.mjs`: markup / cues / chapters / scene-list hashes and duration match the approved import commit `62d2d04` (no tag); a shared-library change that alters its picture, timing or scene descriptions fails `npm test` |
| Structure of every film | `films.test.mjs`: cue targets resolve, cues start in their own scene, **no two cues overlap on one element property**, gradients resolve, deterministic build, captions, chapters |
| Film 2 story points | `rare-or-weld-done.test.mjs`: locked card wording, chapter list, ending scenes, FENCE planted twice, no police officer, names only in `config.js`, runtime window 2:00-3:10 (a ceiling that was raised with each review round; see guide 13.6) |
| Real-browser behaviour | `npm run verify`: all films PASS in headless Chrome (seek determinism over 186 sample times for film 2, one scene + one face at a time, pause freezes everything, replay/restart/skip, **no effect lost after playback + scrubbing + skip + replay**, reduced motion, load/destroy leak nothing, 375 px player). It does not cover whether a gag is funny or readable. |
| It looks right | Done by people and by the contact-sheet review (guide 9.5): one-second stamped sheets of the whole film, reviewed by four Haiku agents on film two's first complete cut; then full-size stills of every changed scene after each owner round. **Frames, not live playback**: the agent that made each change looked at stills; the owner watched the film. The latest sheets (`every:1000`, 8 sheets) were rendered and checked for legibility but not re-reviewed by agents. |
| No console noise | scrubbed both films end to end incl. reduced motion in headless Chrome: no warnings or errors (the old `favicon.ico` 404 is gone) |
| Package | `npm pack --dry-run`: 46 files, 170.7 kB packed, 550.9 kB unpacked (`src/` + docs only) |

## 3. Read first (in this order, ~25 minutes)

1. This file. 2. `MOVIE_AUTHORING_GUIDE.md` (all of it; §0 rules 2, 4, 11; §5; §7; §9 incl. 9.5 visual QA; §11; **§13 lessons from film two**). 3. `src/films/_template/`.
4. `src/engine/timeline.js` (header + `compile()`), `src/engine/film.js`, `src/acting.js`, `src/kit.js` (note `reach` / `aimAlong`).
5. Film 1's `scenes/rival.js` and `bonk.js`, film 2's `scenes/getaway.js` (`kick`) and `scenes/sky.js` (`pop`): choreography with several actors.
6. `dev/sheet.html` in the browser (`npm run dev`): every face, prop, character and set piece.

## 4. Exact steps for the next film (or for review feedback on film 2)

1. `git status` (must be clean; branch from fresh `origin/main` per the root `AGENTS.md`), `npm test`, `npm run verify`: green baseline.
2. **Get the spec from the owner.** Write the approved beats to `src/films/<id>/STORY.md`.
3. `cp -r src/films/_template src/films/<id>`, set `id`/`title`, add one registry line. (Guide §5.)
4. `config.js` first (names, TEXT, TIMING, CAPTION), then `world.js` (include `${FX_DEFS}`), then scenes one at a time.
   After each scene: `npm run shoot -- <id> /tmp/f <scene>+<ms> ...` and LOOK (at full size, including hands, props and contact points),
   then `npm test`, then commit.
5. New reusable art goes in `src/art/` (and on `dev/sheet.html`), new particles in `src/fx/` (+ a unit test); keep
   film-specific things under `src/films/<id>/`.
6. `npm test`, `npm run verify`, the manual checklist (guide §9.3), then **the visual QA review** (§ below / guide 9.5), fix confirmed findings, repeat.
7. Update README's film table and this file. Check `git show --stat` actually contains the doc changes your commit message claims.
8. Record film approval (reference commit + hash-pin test, and a tag only if the owner wants one) only after the owner approves.

## 5. How to avoid duplicating the engine

- A film is *only* `src/films/<id>/` (config, world, scenes, index) + a registry line. If you are about to copy anything
  from `src/engine/`, `src/player/`, `src/acting.js`, `src/kit.js`, `src/fx/` or `src/art/`, stop: import it.
- If film 3 wants something film 1 or 2 has privately (film 1's `sunburst`, `cactus`, ground; film 2's `yard.js` set, museum
  wall, cut-away section), **promote it to `src/art/`** and import it from both; never import from another film's folder.
  After promoting, film 1's hash test and `npm run verify` must stay green.
- If an engine change seems needed, make it in `src/`, add a test or a `dev/verify.js` check, and re-run everything for **all** films.

### 5.1 Reusable pieces film two added (shared, documented in the guide §4, shown on `dev/sheet.html` where they are art)

- `src/acting.js`: `Track` remembers its initial pose (`p0`). `src/kit.js`: `reach` (two-link IK), `aimAlong` (sweep a tool tip along a path, returns tip samples),
  `poseAt` (replay a Track's cues to a pose at time `t`), `gripAt(c, cues, t, hand = 'F' | 'B')` (a character's hand position). These four are what make
  contact, hoses and thrown objects *computed* instead of guessed.
- `src/art/weld.js`: `torch`, `gasCart`, `cartValve`, `hose`, `connectHose`, `dragCart`, posts / fence runs / gate / booth / sign board / plate, `scroll` + `scrollPoint`,
  `swagSack` (bank bag with an open mouth, origin = mouth). `src/art/prospector.js`: the `kind: 'thief'` rig (goggles up / down, `dressUp` top hat and bow tie, faces).
  `src/art/emerald.js`, `balloons.js` (`BalloonCloud`), `heist.js`, `crowd.js` (`tourist`).
- `src/fx/effects.js`: `arc` (welding flare), `popBurst`, `lightbulb`, `rings`, `rays({ late })`, and the `.fx-late` class (fill forwards, so an effect whose first keyframe is visible
  does not show during its start delay).
- `dev/shoot.mjs`: `every:<ms>`, `STAMP=1` (burned-in time and scene id), `SHEETS=<n>` (several consecutive contact sheets), `SETTLE`. See 5.2.
- **Still film-specific, promote to `src/art/` if a third film wants them** (guide 13.5 explains why they exist): `museumFront` / `wallHole` / `sectionBack` / `sectionFront` / `galleryFront`
  / `paintings` / `securityCam` / `searchlight` / `stone` in `src/films/rare-or-weld-done/world.js`, and the yard set in `scenes/yard.js`.

### 5.2 The visual QA process (guide 9.5 and 9.6 are the full text)

1. Print the scene table (guide 9.5 step 1), render the whole film stamped at ~1 s:
   `STAMP=1 SHEETS=8 COLS=4 W=640 H=360 SETTLE=60 npm run shoot -- <film> /tmp/qa/<film> every:1000` (about 50 s for 3 minutes).
2. Give consecutive quarters of the sheets (with one sheet of overlap) to four independent, inexpensive vision-capable reviewers with the premise, the locked material,
   the scene table with what each scene is *meant* to show, and the report format (timestamp, scene, evidence, severity, suggested change, "needs closer look").
3. Consolidate into a findings file; verify each finding yourself at full size and classify it (confirmed defect / false positive / subjective / unresolved);
   fix only what is confirmed, keep locked and approved material; re-shoot the affected scenes; `npm test` and `npm run verify`.
4. The sheets find *where to look*. They cannot judge fast actions (shoot 100-250 ms steps), contact (look full size), cut boundaries (shoot first and last frame), motion and comic timing
   (watch it), the phone layout (`UI=1 W=375 H=812`) or effects across seeks (`npm run verify`). They do not replace `npm run verify` or watching the film.

### 5.3 How a fresh agent should approach the next film or an in-universe advertisement

1. Get the brief from the owner and write it to `src/films/<id>/STORY.md` first; note what is locked. For an advertisement, also write the runtime budget (guide 13.6: runtime grew by
   about 27 s over film two's review rounds; decide the budget up front) and the one thing the viewer must remember.
2. Copy `src/films/_template/`; build `config.js`, then `world.js`, then scenes **one at a time, looking at full-size stills of each before moving on**, and commit per scene.
3. Reuse art from `src/art/` before drawing anything; if a new thing may be reused, put it in `src/art/` with a `dev/sheet.html` entry.
4. Compute contact and attachment (13.1), lean with the root (13.2), make effects follow causes (13.4), keep the world's state across shots (13.5), give camera moves a hold (13.6).
5. When the first full cut exists, run the visual QA process (5.2) *before* showing the owner, and again after each owner round that changes timing.
6. Keep an eye on the cue overlap test, the scene table (timestamps move), and the runtime ceiling in the film's test.
7. Write the interpretation of any ambiguous note in your reply. Follow the RuneSpace issue/PR workflow; never merge, tag or push a tag without being asked.

## 6. Known limitations and known issues

- **Two latent timing slips in film 1** (left alone on purpose, since the film is approved): `idle(pip, 0, 3300, 1100)` in
  `src/films/that-mines-mine/scenes/rival.js` and `idle(rex, 0, 3400, 900)` in `scenes/payoff.js` pass film-relative `0`
  where `at(0)` was meant. `test/films.test.mjs` allow-lists exactly those two cues; delete the entry if you fix them (that
  changes film 1's picture subtly: it needs re-approval and new hashes in `test/film1-approved.test.mjs`). Film 1 also has
  43 overlapping Track cues; `OVERLAPS_ALLOWED` in `films.test.mjs` exempts it. New films get no exceptions.
- **Film 2 runtime is about 3:01** (2:34 at the first review, 2:46 after the continuity pass, 3:01 after the rock gag, the longer bag gag and the held camera beats), well past the original
  "about 2 minutes, up to roughly 2:30" target. Card timings follow the ~1 s + 0.4 s/word rule (film 1's lesson) and were not shortened; the owner approved the card lengths.
  If the owner wants it shorter, trim non-text holds (`balloons`, `cut`, `vault`), not the slowed actions or the held camera beats. The owner has not been asked to accept 3:01.
- **Performance.** Film 2 keeps ~2,550 Web Animations alive (film 1: ~1,340; `npm run verify` prints the count). In headless Chrome with *software* rendering
  (no GPU) film 2's busiest scenes run at ~20-36 ms/frame, comparable to film 1 measured the same way. **Untested on a real
  low-end phone.** Cheap wins if needed: fewer `sparks`/`puff` along the cut (`scenes/heist.js`), fewer pebbles/stars in `world.js`,
  fewer tourists in `queue`.
- **Review items not individually tracked.** The first visual review produced many low-severity notes; only the confirmed defects and the owner's notes were fixed and no per-item
  disposition was kept (for example the moon appearing without a fade was declined; others were never individually dispositioned). If you re-review, keep the findings in a file.
- **"Effects vanish after using the controls"** (reported once) did not reproduce and nothing was changed for it; see guide 3.4. If it comes back, `npm run verify`'s
  "no effect is lost" check and a computed-style diff are the first tools.
- **The bag gag's mouth is seen at an angle** (pressed on the gem's slanted face), so its dark opening reads in only a few frames; it can be turned more face-on if the owner asks.
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

1. **Approval of film 2** (record it as §1 describes; no tag until the owner asks). Note any feedback in this file.
2. **Lore:** the third planet is now named Tortuga-9 and the museum sign reads `TORTUGA-9 MUSEUM` (owner-authorized, with the
   `film2-approved` pin regenerated). The Emerald's real name is still undecided; change `NAMES` in film 2's `config.js`
   (and re-check the sign lettering fit, see `signboard()` font fitting).
3. **Runtime budget** for film 2 (now about 3:01, never explicitly accepted) and later films (see §6, guide 13.6).
4. **Promote film two's museum set** (`museumFront`, `sectionBack`/`sectionFront`, `securityCam`, `searchlight`) to `src/art/` only when a third film needs it (§5.1).
5. **Barrel export of `thatMinesMine`** bundles film 1 into any import of `src/index.js`; keep for compatibility or drop it.
6. **Fonts:** system stacks, or load Playfair Display in the host for a consistent card look.
7. **Packaging:** vendor `src/` into RuneSpace or consume the `npm pack` tarball (both work).
8. **TypeScript conversion** of `src/`: deferred.

## 8. Out of scope so far (do not start without being asked)

Ticket purchases, Credit deductions, buffs, showtime scheduling, any backend, the Drive-In world location, pre-show
commercials, and a third film. "5 CREDITS ADMISSION" in film 2 is a gag price inside the story, not the Drive-In ticket price.

## 9. Commands

```bash
npm run dev          # http://127.0.0.1:5173/?film=<id>   (&t=ms &cc=1 &reduced=1 &ui=0 &bare=1)
npm test             # structure + unit + docs + film-one pin + film-two story tests, ~0.4 s
npm run verify       # real-browser checks for every film, ~100 s
npm run shoot -- <film> <out-prefix> <ms | scene+ms | every:ms> ...   # stills + contact sheet(s) (COLS= W= H= UI=1 REDUCED=1 STAMP=1 SHEETS=n SETTLE=ms)
npm run pack:check   # what would ship
git log --oneline -- tools/holo-film-studio   # from the RuneSpace root; includes the original standalone history
```
