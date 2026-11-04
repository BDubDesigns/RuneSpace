# RuneSpace Movies

A standalone, dependency-free silent-film engine and player for the Skatboll holo-drive-in, plus the
films made with it. No framework, no build step, no backend, no third-party animation library: plain
ES modules, SVG, the native Web Animations API and three stylesheets. It drops into a RuneSpace React
panel (or any webview) without rewriting anything.

| Film | Runtime | Status |
|---|---|---|
| **That Mines Mine!** (`that-mines-mine`) | 1:43, black-and-white, 16:9 | complete, approved (git tag `film1-approved`) |
| **Rare or Weld Done?** (`rare-or-weld-done`) | 2:55, black-and-white, 16:9 | complete, **awaiting owner approval** (no `film2-approved` tag yet) |

**Watching the films** (after `npm run dev`):

| Film | Open |
|---|---|
| That Mines Mine! | <http://127.0.0.1:5173/?film=that-mines-mine> |
| Rare or Weld Done? | <http://127.0.0.1:5173/?film=rare-or-weld-done> |

Press the big play button (or `Space`). The chapter buttons under the picture jump to the story beats; the picker
above the picture switches films. Handy extras: `&cc=1` captions, `&t=40000` start paused at 40 s, `&reduced=1`
reduced motion, `&autoplay=1`. Fullscreen is the `F` key or the control bar. `Home` / `R` restart, `End` skips to the
final frame. Playback needs a *visible* page (a hidden tab freezes the clock).

**Docs, in reading order**

1. `NEXT_FILM_HANDOFF.md`: status, exact next steps, known issues, open decisions (start here for new work).
2. `MOVIE_AUTHORING_GUIDE.md`: architecture, timeline internals, how to build a film, testing, packaging, pitfalls.
3. This README: setup, running, testing, packaging, public API.

---

## 1. Setup

Requirements: **Node ≥ 22** (dev server, tests, headless verify) and, for `npm run verify`, a
Chrome/Chromium (`CHROME_BIN=/path/to/chrome` if it isn't on `PATH`). There is nothing to install:
the project has **no dependencies** (no `npm install` needed).

```bash
git clone <this repo> && cd runespace-movies
npm test          # fast structural + unit tests (Node only)
npm run dev       # http://127.0.0.1:5173/
```

## 2. Development

```bash
npm run dev       # zero-dependency no-cache static server (ES modules need an HTTP origin, not file://)
```

Demo page URL parameters:

| Param | Effect |
|---|---|
| `?film=<id>` | which film (default: the first registered). `?film=template` opens the hidden template film |
| `?t=41000` | start paused at 41 s (great for screenshots) |
| `?autoplay=1` | start playing (browsers may block this until a click) |
| `?cc=1` | captions on |
| `?reduced=1` / `?reduced=0` | force reduced motion on / off (default follows the OS) |
| `?ui=0` | hide the control bar |
| `?bare=1` | picture only, edge to edge |

`window.__film` is the player instance (await `window.__filmReady` first in scripts).
`dev/sheet.html` is an art sheet of every character face, prop, set piece and crowd member (both films' art). `dev/verify.html?film=<id>`
is the interactive verification report.

Keyboard (player focused): `Space`/`K` play-pause · `←`/`→` ±5 s · `Home` restart paused · `End` skip to end · `R` restart · `C` captions · `F` fullscreen.

## 3. Testing

```bash
npm test          # ~0.3 s. node:test, no browser. Runs against EVERY registered film.
npm run verify    # ~20 s. Real engine in headless Chrome, for every registered film.
node dev/verify-headless.mjs that-mines-mine      # one film
npm run shoot -- rare-or-weld-done /tmp/frames/k s-kick+2100 s-plate+7000   # render stills (see dev/shoot.mjs)
```

- `npm test` checks each film's structure (every cue target exists in the markup, every cue starts in its
  own scene, no two cues overlap on one element, gradients resolve, deterministic `build()`, scenes captioned,
  chapters valid), the engine's pure parts (`Track`, `defineFilm`, effects, `reach`/`aimAlong`, balloons, crowd),
  SSR-safe imports, that the docs name real files/scripts, that **film one still builds exactly as approved**
  (`test/film1-approved.test.mjs`) and the locked story points of film two (`test/rare-or-weld-done.test.mjs`).
- `npm run verify` proves the behaviour that matters: seek determinism (same picture however you arrive
  at a time), one scene/face visible at a time, pause freezes *everything* (including film grain), natural
  end/replay/restart, reduced motion, `load()`/`destroy()` leak nothing, and a 375 px phone-width player.
- Still manual (see the guide, §9.3): looking at it. Seek every scene, read every card, watch on a phone.
  `npm run shoot` renders any frame so you can check a gag without a browser session.

## 4. Project structure

```
index.html / script.js / styles.css     demo page (not part of the module)
dev/   serve.mjs  sheet.html  shoot.mjs  verify.html  verify.js  verify-headless.mjs   dev tools (not shipped)
test/  films.test.mjs engine.test.mjs docs.test.mjs film1-approved.test.mjs rare-or-weld-done.test.mjs
src/                                    THE MODULE (what ships)
  index.js  index.d.ts                  public entry + types
  engine/   timeline.js film.js         the ONE seekable clock · film definition -> markup + cues
  player/   player.js player.css        DOM shell, controls, captions, keyboard, public API
  acting.js                             Track: records poses and emits cues (move / hop / keys)
  kit.js                                Camera, blow, popIn, idle, driftClouds, reach/aimAlong (tool IK), filmHelpers
  fx/       effects.js effects.css film-look.css   particles, impact words, welding arc, FX_DEFS · grain/vignette/flicker/weave
  art/      prospector.js props.js cards.js        character rig (pip, rex, thief) · props · title cards
            weld.js emerald.js balloons.js heist.js crowd.js   welding gear + fence/booth/sign · the gem + gallery furniture ·
                                                              balloons, bird, BalloonCloud · newspaper, dealer, Credits · tourists
  films/
    index.js                            film registry (FILMS, listFilms, loadFilm)
    that-mines-mine/                    config.js index.js world.js scenes/*.js
    rare-or-weld-done/                  STORY.md config.js index.js world.js scenes/{setup,heist,getaway,sky,finale,yard}.js
    _template/                          minimal working film to copy for a new one
```

Everything film-specific lives under `src/films/<id>/`; everything else in `src/` is shared.

### How the animation works (and why pause really pauses everything)

Patterns are borrowed from RuneSpace's `FlightCinematic`, `globals.css` and `use-scene-cue-player`: SVG
layers addressed by a target attribute, effects built from radial gradients and a never-fully-off
flicker, `element.animate()` with `delay: cue.at` and `fill`, an `is-reduced` override, `--var` driven
timing. RuneSpace's cue player has no pause/seek, so this adds a master clock:

* **Cues** (`{ at, dur, target, keyframes, ... }`) compile to `element.animate()`. Targets are `data-t="name"`
  elements. For each element + property the first cue fills backwards and forwards, later ones forwards only,
  so seeking anywhere restores the exact pose.
* **CSS keyframe effects** (dust, sparks, grain, flicker, scratches, gate weave) read `--at`/`--dur`
  custom properties and are collected with `root.getAnimations({ subtree: true })`.
* Both kinds are driven from one master animation's `currentTime`. Pause pauses *all* of them, seek sets them all,
  looping effects are deterministic functions of `t`. No `setTimeout` chains.

## 5. Public API

```js
import { createMoviePlayer, loadFilm } from './src/index.js';

const player = createMoviePlayer(containerEl, {
  film: await loadFilm('that-mines-mine'),   // or call player.load(film) later
  controls: true,             // false = picture only, drive it yourself
  captions: false,
  reducedMotion: 'auto',      // 'auto' | true | false
  autoplay: false,
});

player.play();   player.pause();   player.toggle();
player.seek(41000);          // ms; keeps paused/playing as it was
player.restart();            // back to 0 and play
player.skip();               // final frame ("THE END")
player.load(otherFilm);      // swap film (grain/flicker/weave survive the swap)
player.destroy();            // removes DOM, cancels every animation, drops listeners

player.state      // 'idle' | 'playing' | 'paused' | 'ended'
player.time       // ms        player.duration  // ms
player.scenes     // [{ id, label, caption, start, end }]
player.chapters   // story-beat jump points: [{ id, label, at }]

const off = player.on('state', (s) => {});   // also 'time', 'scene', 'load'
```

Headless use (your own UI): `createMoviePlayer(el, { controls: false })`.
Lowest level: `createTimeline(rootElement, { duration, cues })` gives the clock alone.
Types: `src/index.d.ts`. Film registry: `FILMS`, `listFilms()`, `loadFilm(id)` (lazy dynamic import).

## 6. Adding a film

```bash
cp -r src/films/_template src/films/<new-id>     # then follow MOVIE_AUTHORING_GUIDE.md §5
```

Register one line in `src/films/index.js`, write `config.js` / `world.js` / `scenes/*.js` / `index.js`,
run `npm test && npm run verify`. Changing text, timing, transitions or chapters of an existing film:
`config.js` (`TEXT`, `TIMING`, `CAPTION`) and `index.js`.

## 7. Reduced motion

Honours `prefers-reduced-motion` by default; the control bar's wave button toggles it. The timeline rebuilds
in place (time and play state are kept). In reduced mode particles, camera shake, walk/bob cycles, grain,
flicker, scratches and gate weave are dropped; big travel becomes an instant jump to the end pose; story
symbols (`BONK!`, `!`, `?`, Zzz, the idea bulb) fade in and out in place; title cards, expressions, signs and
ore appear as normal so the story still reads. Per-cue control is the `reduce: 'skip' | 'snap'` flag.

## 8. Packaging and embedding in RuneSpace

The shippable unit is `src/`: about 480 KB of source for the two films (≈ 145 KB packed), no dependencies, no network, storage,
audio or globals.

```bash
npm run pack:check     # lists what `npm pack` would ship (src/ + docs only; never dev/, test/, node_modules)
npm pack               # produces runespace-movies-<version>.tgz
```

Or copy `src/` into the app (for example `features/theatre/movies/`). Import the three stylesheets once
(`src/player/player.css`, `src/fx/effects.css`, `src/fx/film-look.css`) and mount from an effect. Nothing in
a film touches React.

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { createMoviePlayer, loadFilm, type MoviePlayer } from '@/features/theatre/movies/src';
import '@/features/theatre/movies/src/player/player.css';
import '@/features/theatre/movies/src/fx/effects.css';
import '@/features/theatre/movies/src/fx/film-look.css';

export function DriveInScreen({ filmId, onEnd }: { filmId: string; onEnd?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let player: MoviePlayer | undefined, off: (() => void) | undefined, cancelled = false;
    loadFilm(filmId).then((film) => {
      if (cancelled || !host.current) return;
      player = createMoviePlayer(host.current, { film });
      off = player.on('state', (s) => s === 'ended' && onEnd?.());
    });
    return () => { cancelled = true; off?.(); player?.destroy(); };   // StrictMode-safe
  }, [filmId, onEnd]);
  return <div ref={host} />;
}
```

Integration notes: the player is `width: 100%` at the film's aspect ratio and its narrow layout follows the
player's own width (container query), so size it by its container. Importing the barrel is SSR-safe;
`createMoviePlayer` needs a browser, so call it in an effect. `thatMinesMine` is still exported statically
for the original recipe (it bundles that film); `loadFilm()` is lazy. Reduced motion: leave `'auto'` or pass
RuneSpace's setting and call `player.setReducedMotion(v)`. Theming via CSS custom properties on
`.mm-player` (`--mm-accent`, `--mm-bar-bg`, `--mm-fg`, `--mm-muted`, `--mm-radius`). Game hooks (tickets,
buffs, "watched" flags) are intentionally not here: listen to `player.on('state' | 'scene' | 'time')`
from the host. More in `MOVIE_AUTHORING_GUIDE.md` §10.

## 9. Capturing frames / video

Playback is a pure function of time, so exporting is a loop of `seek` + screenshot (documented, not part of
the automated checks):

```js
// Playwright / Puppeteer, page = http://127.0.0.1:5173/?bare=1&ui=0
await page.evaluate(() => window.__filmReady);
for (let t = 0; t <= duration; t += 1000 / 30) {
  await page.evaluate((t) => __film.seek(t), t);
  await page.screenshot({ path: `frames/${String(frame++).padStart(5, '0')}.png` });
}
// ffmpeg -framerate 30 -i frames/%05d.png -pix_fmt yuv420p out.mp4
```

## 10. Version control

This directory is a git repository (`main`). `film1-approved` tags the approved first film.
`.gitignore` excludes `node_modules/`, `dist/`, `*.tgz` and `frames/`: no generated or temporary artifacts
are tracked. `npm test && npm run verify` should be green before every commit.
