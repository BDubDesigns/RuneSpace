# RuneSpace Movies · *That Mines Mine!*

A standalone, dependency-free silent-film module for the Skatboll holo-drive-in.
The first film, **That Mines Mine!** (about 1:40, black-and-white, 16:9), is a
slapstick two-prospector claim dispute told in SVG, native Web Animations and CSS.

No framework, no build step, no backend, no third-party animation library.
It is plain ES modules plus three stylesheets, so it can be dropped into a
RuneSpace React panel (or any webview) without rewriting the animation.

---

## 1. Run it

ES modules need an HTTP origin (browsers block `import` from `file://`).
Any static server works. The repo ships a tiny zero-dependency one:

```bash
node dev/serve.mjs          # http://127.0.0.1:5173/   (no-cache, for development)
```

Demo page URL parameters:

| Param | Effect |
|---|---|
| `?t=41000` | start paused at 41 s (great for screenshots) |
| `?autoplay=1` | start playing (browsers may block this until a click) |
| `?cc=1` | captions on |
| `?reduced=1` / `?reduced=0` | force reduced motion on / off (default follows the OS) |
| `?ui=0` | hide the control bar |
| `?bare=1` | picture only, edge to edge |

`window.__film` is the player instance, handy from the console.
`dev/sheet.html` is a character/prop art sheet for tuning the art.

Keyboard (player focused): `Space`/`K` play-pause · `←`/`→` ±5 s · `Home` restart paused · `End` skip to end · `R` restart · `C` captions · `F` fullscreen.

---

## 2. Project structure

```
index.html / script.js / styles.css     demo page (not part of the module)
src/
  index.js  index.d.ts                  public entry + types
  engine/
    timeline.js                         ONE seekable clock for every animation
    film.js                             film definition -> markup + cues (transitions, chapters)
  player/
    player.js  player.css               DOM shell, controls, captions, keyboard, public API
  fx/
    effects.js  effects.css             reusable particles: dust, sparks, impact words, stars...
    film-look.css                       grain, vignette, flicker, scratches, gate weave
  acting.js                             Track: records poses and emits cues (move/hop/keys)
  art/
    prospector.js                       parametric cartoon character rig (+ faces, walk cycle)
    props.js                            cutter, mallet, signs, mine cart, ore, ore pile, boulder
    cards.js                            silent-film title cards
  films/that-mines-mine/
    config.js                           ALL title-card text, captions and scene durations
    index.js                            scene order, transitions, chapters (story beats)
    world.js                            locations (mine front, behind the mountain, cave, sunburst)
    kit.js                              camera, blows, pop-ins, cloud drift
    scenes/                             discovery.js · rival.js · bonk.js · mining.js · payoff.js
dev/                                    serve.mjs, sheet.html (development tools)
```

Separation of concerns:

* **Content** – `films/` (what happens, when, what the cards say).
* **Reusable animation** – `acting.js`, `art/`, `fx/effects.*` (nothing film-specific).
* **Visual effects** – `fx/film-look.css` and `fx/effects.css`.
* **Player controls** – `player/`.
* **Clock** – `engine/timeline.js`.

### How the animation works (and why pause really pauses everything)

Patterns are borrowed from RuneSpace's `FlightCinematic`, `globals.css` and
`use-scene-cue-player`: SVG layers addressed by a target attribute, effects built
from radial gradients and a never-fully-off flicker, `element.animate()` with
`delay: cue.at` and `fill`, an `is-reduced` override, and `--var` driven timing.
RuneSpace's cue player has no pause/seek, so this adds a master clock:

* **Cues** (`{ at, dur, target, keyframes, ... }`) compile to `element.animate()`.
  Targets are `data-t="name"` elements. Multi-property cues are split per property;
  for each element + property the first cue fills backwards and forwards, later ones
  forwards only, so seeking anywhere restores the exact pose.
* **CSS keyframe effects** (dust, sparks, grain, flicker, scratches, gate weave) read
  `--at`/`--dur` custom properties. The timeline collects them with
  `root.getAnimations({ subtree: true })`.
* Both kinds are controlled together from one master animation's `currentTime`.
  Pause pauses *all* of them (the grain stops too), seek sets them all, and
  looping effects are deterministic functions of `t`. No `setTimeout` chains.

Verified in the running page: after `seek(t)` the whole picture (1,347 elements'
computed transform/opacity/visibility) is identical whether you arrive forward,
backward or by jumping, and identical to the frame reached by real playback.

---

## 3. Public API

```js
import { createMoviePlayer, thatMinesMine } from './src/index.js';

const player = createMoviePlayer(containerEl, {
  film: thatMinesMine,        // or call player.load(film) later
  controls: true,             // false = picture only, drive it yourself
  captions: false,
  reducedMotion: 'auto',      // 'auto' | true | false
  autoplay: false,
});

player.play();   player.pause();   player.toggle();
player.seek(41000);          // ms; keeps paused/playing as it was
player.restart();            // back to 0 and play
player.skip();               // final frame ("THE END")
player.load(otherFilm);      // swap film
player.destroy();            // removes DOM, cancels every animation, drops listeners

player.state      // 'idle' | 'playing' | 'paused' | 'ended'
player.time       // ms        player.duration  // ms
player.scenes     // [{ id, label, caption, start, end }]
player.chapters   // the eight story beats: [{ id, label, at }]

const off = player.on('state', (s) => {});   // also 'time', 'scene', 'load'
```

Headless use (your own UI): `createMoviePlayer(el, { controls: false })`.
Lowest level: `createTimeline(rootElement, { duration, cues })` gives the clock alone.

---

## 4. Changing timing and text

* **Text** – `src/films/that-mines-mine/config.js` → `TEXT` (title cards) and `CAPTION` (the CC text).
* **Scene lengths** – `TIMING` in the same file. Scenes re-flow automatically (start = running sum).
* **Action timing inside a scene** – each scene file schedules cues relative to its own start
  (`at(1500)` = 1.5 s into the scene). Keep action inside the scene's `TIMING` value.
* **Order / transitions / chapters** – `films/that-mines-mine/index.js`
  (`in`/`out`: `'cut' | 'iris' | 'fade'`, `irisIn`/`irisOut` centres in %, `inMs`/`outMs`).
* **Look** – CSS variables on `.mm-player` (`--mm-accent`, …), and the grain / vignette /
  flicker keyframes in `fx/film-look.css`.
* **Characters** – `KINDS` in `art/prospector.js` (proportions, face placement), face drawings in `faceArt()`.

The eight approved beats map to chapters `beat1`…`beat8` (see `chapters` in `index.js`).

---

## 5. Reduced motion

Honours `prefers-reduced-motion` by default; the control bar's wave button toggles it.
The timeline rebuilds in place (time and play state are kept). In reduced mode:

* particles (dust, sparks, chips, orbiting stars), camera shake, walk/bob cycles,
  grain, flicker, scratches, specks and gate weave are dropped;
* big travel (running, flinging, falling, the runaway cart) becomes an instant jump to
  the end pose;
* story symbols (**BONK!**, "!", "?", Zzz, the idea bulb) fade in and out in place;
  title cards, expressions, X-eyes, signs and ore appear exactly as normal, so the
  story still reads.

---

## 6. Embedding in a RuneSpace React panel

Copy `src/` into the app (e.g. `features/theatre/movies/`), import the three
stylesheets once, and mount in an effect. Nothing in the film touches React.

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { createMoviePlayer, thatMinesMine, type MoviePlayer } from '@/features/theatre/movies/src';
import '@/features/theatre/movies/src/player/player.css';
import '@/features/theatre/movies/src/fx/effects.css';
import '@/features/theatre/movies/src/fx/film-look.css';

export function DriveInScreen({ onEnd }: { onEnd?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const player: MoviePlayer = createMoviePlayer(host.current!, { film: thatMinesMine });
    const off = player.on('state', (s) => s === 'ended' && onEnd?.());
    return () => { off(); player.destroy(); };       // StrictMode-safe
  }, [onEnd]);
  return <div ref={host} />;
}
```

Notes for integration:

* Layout: the player is `width: 100%` and keeps its 16:9 ratio (`--mm-aspect`), so size it by
  its container. It uses container-query units, so it scales inside any panel.
* Reduced motion: leave `reducedMotion: 'auto'`, or pass RuneSpace's own setting
  (`reducedMotion: usePrefersReducedMotion()` and call `player.setReducedMotion(v)` on change).
* No audio, no network, no storage, no globals other than the optional `window.__film` in the demo.
* The modules are untyped JS with a hand-written `index.d.ts`; convert to TS later if you prefer.
* Game hooks (tickets, buffs, "watched" flags) are intentionally not here. Listen to
  `player.on('state' | 'scene' | 'time')` from the host.

---

## 7. Capturing frames / video

Playback is a pure function of time, so exporting is a loop of `seek` + screenshot:

```js
// Playwright / Puppeteer, page = http://127.0.0.1:5173/?bare=1&ui=0
for (let t = 0; t <= duration; t += 1000 / 30) {
  await page.evaluate((t) => __film.seek(t), t);
  await page.screenshot({ path: `frames/${String(frame++).padStart(5, '0')}.png` });
}
// ffmpeg -framerate 30 -i frames/%05d.png -pix_fmt yuv420p that-mines-mine.mp4
```

In the browser, `MediaRecorder` on a `getDisplayMedia` capture of the player also works.

---

## 8. Follow-ups: *Rare or Weld Done?* on the same system

Everything film-specific lives in `films/<name>/`. A second film reuses the engine,
player, fx, title cards, camera, `Track` acting layer and prospector rig as they are.

* **New film** – copy `films/that-mines-mine/` to `films/rare-or-weld-done/`, edit
  `config.js`, write scenes, export from `src/index.js`.
* **Reusable already** – `Camera`, `blow()` (mallet/hammer strike), `popIn()` (in `kit.js`), the ore `flyer()` arc helper (in `scenes/mining.js`, easy to lift into `kit.js`),
  `pow()` impact words, `sparks()`, `dust()`, `dizzy()`, title cards, iris/fade transitions.
* **Likely additions** – a welder prop (torch with a flickering `fx-glint` bead and a
  `sparks()` fountain), a "rare ore" prop with a slow shimmer (RuneSpace's `rs-item-shimmer`
  idea as a CSS keyframe), a "tool-swap" gag using the `propF` track, a second cast member
  via a new `KINDS` entry in `prospector.js`, and a welded-shut mine door as a location in `world.js`.
* **Gag potential** – the cutter that bonked in this film can reappear (the cutter is already
  set up as the story's recurring tool); "rare" vs "weld done" suits a pun-title-card
  structure with a hard cut between the two readings.
* **Nice engine upgrades** – chapter markers on the scrub bar, a `ready`/`ended` promise, and
  an optional `playbackRate` (all animations already share one clock).
