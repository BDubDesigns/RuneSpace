# Movie Authoring Guide

How to make a new silent film with this project's engine. Everything here describes the code as it
exists today (file names, function names and argument lists are real). If the code and this guide
ever disagree, the code wins: fix the guide, and `test/docs.test.mjs` will tell you when a path in
it goes stale.

Read this once top to bottom, then keep sections 5, 6 and 10 open while working.

---

## 0. The eleven rules (read these even if you read nothing else)

1. **Films are data.** A film is a `defineFilm({...})` object: scene builders return SVG strings and
   push *cues* (timed animations) into one shared list. The engine turns that into one seekable clock.
2. **Wrap every scene-relative time in `at()`.** `ctx.at(1500)` = "1.5 s into this scene" as absolute
   film time. Forgetting it puts the action in the wrong scene and nothing crashes. (`npm test` catches it.)
3. **Prefix every `data-t` name with `ctx.id`** (`${id}.pip`). Names must be unique across the whole film.
4. **Never use `setTimeout`, `requestAnimationFrame`, JS-driven animation or `style.transition`.**
   Only cues and `--at/--dur` CSS effects live on the master clock, so only they pause and seek.
5. **Include `FX_DEFS` in your film's `defs`.** Dust and smoke paint with gradients defined there.
6. **Every cue should say what reduced motion does** (`reduce: 'skip' | 'snap'`) unless the motion is
   essential. No flag = it plays in full even for users who asked for less motion.
7. **Don't import from another film's folder.** Shared things live in `src/` (engine, `kit.js`, `art/`, `fx/`).
8. **Don't edit "That Mines Mine!"** unless asked. It is approved. Tests and `film1-approved` (git tag) protect it.
9. **Run `npm test` and `npm run verify` before calling anything done** (section 9).
10. **Look at it.** Seek to every scene in a real browser, including a phone-width one. Green tests do not mean funny.
    (`npm run shoot -- <film> <prefix> <scene+ms> ...` renders stills headlessly.)
11. **Sequence the cues on a Track; never overlap them.** Every `Track` cue starts from the *end pose* of the previous
    one, so two cues running at once make the picture jump to the first one's end pose. While `walk()` / `aimAlong()` /
    `hop()` runs on a character, do not touch the same body part (`root`, `bob`, `legF`, `armF` ...) in that window; use
    another Track (`torso` for a lean or a jolt, `head`, `hat`, `propF`) or start the next cue when the last one ends.
    `npm test` fails with the offending cues for any new film.

---

## 1. Architecture

```
 ┌───────────────────────── host page / RuneSpace React panel ─────────────────────────┐
 │  createMoviePlayer(container, { film })        ← src/player/  (DOM, controls, a11y) │
 │        │ film.build() → { markup, cues, duration, scenes, chapters }                │
 │        │                       ▲                                                    │
 │        │            defineFilm({ scenes: [...] })   ← src/engine/film.js            │
 │        │                       ▲                                                    │
 │        │      scene builders (ctx) => svg string    ← src/films/<film>/scenes/*.js  │
 │        ▼                       │ use                                                │
 │  createTimeline(stage, { duration, cues })   ← src/engine/timeline.js               │
 │   ONE master clock; drives cue animations + CSS effect animations together          │
 │                                                                                     │
 │  helpers a scene uses:  Track/tween/show (src/acting.js)   Camera/blow/popIn/…      │
 │  (src/kit.js)   prospector rig, props, title cards (src/art/)   particles (src/fx/)│
 └─────────────────────────────────────────────────────────────────────────────────────┘
```

Data flow at load: `player.load(film)` → `film.build()` (pure, deterministic, no DOM) → the SVG
markup is injected into `.mm-svg` → `createTimeline()` finds every `[data-t]` element and compiles
the cue list into paused Web Animations → everything is driven from one master animation's
`currentTime`.

### 1.1 Directory structure and who owns what

```
index.html  script.js  styles.css        demo page (not part of the shipped module)
dev/                                      development tools (not shipped)
  serve.mjs                                 zero-dep no-cache static server (+ startServer() export)
  sheet.html                                art sheet: every face, prop, character on one page
  verify.html  verify.js                    in-browser checks for one film (?film=<id>)
  verify-headless.mjs                       runs verify.html for all films in headless Chrome
test/                                     node:test suites (no browser needed)
src/                                      THE MODULE (what gets shipped / copied into RuneSpace)
  index.js  index.d.ts                      public entry + hand-written types
  ── ENGINE (film-agnostic; shared by every film) ──────────────────────────────────────
  engine/timeline.js                        the seekable master clock (WAAPI)
  engine/film.js                            defineFilm(): scenes → markup + cues, iris/fade transitions
  player/player.js  player.css              mount point, controls, captions, keyboard, public API
  acting.js                                 Track (pose-recording cue emitter), tween(), show()
  kit.js                                    Camera, driftClouds, idle, fwd, blow, popIn, filmHelpers
  ── REUSABLE ART + EFFECTS (film-agnostic building blocks) ────────────────────────────
  fx/effects.js  fx/effects.css             particles/impact words as SVG + CSS keyframes; FX_DEFS
  fx/film-look.css                          grain, vignette, flicker, scratches, gate weave
  art/prospector.js                         parametric cartoon character rig (cast: pip, rex, thief)
  art/props.js                              ore, cutter, mallet, sign, mine cart, ore pile, boulder
  art/cards.js                              silent-film title cards
  art/weld.js                               torch, gas cart, fence runs/posts, gate, ticket booth, admission sign, plate, scroll
  art/emerald.js                            the giant gem, plinth, stanchions, rope, placard
  art/balloons.js                           balloon, bird, scrap, BalloonCloud (tie on / stretch / pop)
  art/heist.js                              newspaper, thought bubble, the FENCE dealer, Credits (coin, pile, bag)
  art/crowd.js                              tourist(): seven cheap background people
  ── FILMS (everything specific to one movie) ──────────────────────────────────────────
  films/index.js                            registry: FILMS, listFilms(), loadFilm(id)
  films/rare-or-weld-done/                  film two (STORY.md = the approved screenplay; scenes/yard.js = the fence set)
  films/that-mines-mine/                    the approved first film
    config.js                                 TEXT (cards), TIMING (scene ms), CAPTION (CC text)
    index.js                                  scene order, transitions, chapters
    world.js                                  its locations + WORLD_DEFS (gradients/patterns)
    scenes/discovery|rival|bonk|mining|payoff.js   the action, one function per scene
  films/_template/                          minimal working film to copy (hidden in the demo list)
```

**The rule of thumb:** if a file lives under `src/films/<id>/`, it belongs to that film alone.
Everything else in `src/` must stay film-agnostic.

### 1.2 What is "the engine" (reusable, don't fork per film)

| File | Role |
|---|---|
| `src/engine/timeline.js` | Master clock; compiles cues; play/pause/seek/restart/skip/reduced-motion/destroy. |
| `src/engine/film.js` | `defineFilm()`; scene start times; shot visibility; iris/fade; chapters. |
| `src/player/player.js`, `player.css` | DOM shell, controls, captions, keyboard, poster frame, the public API. |
| `src/acting.js` | `Track`, `tween`, `show`. |
| `src/kit.js` | `Camera`, `driftClouds`, `idle`, `fwd`, `blow`, `popIn`, `filmHelpers`. |
| `src/fx/*` | Effects + film-look CSS. |
| `src/art/*` | Rig, props, cards. These are *content libraries*: new films add to them. |
| `src/films/index.js` | Registry. One line per film. |

### 1.3 What is "a movie" (film-specific)

Everything under `src/films/<id>/`: scenes and their timelines (`scenes/*.js`), locations
(`world.js`), title-card text and scene durations (`config.js`), the scene order/transitions
(`index.js`). Characters and props are *shared libraries* in `src/art/`; a film that needs a new one
adds it there (or, if it truly is single-use, in its own folder).

---

## 2. Core concepts

**Film** – `defineFilm({ id, title, width, height, posterAt, defs, chapters, scenes })`
(`src/engine/film.js`). `width`/`height` default 1280×720; all art is authored in that coordinate space.

**Scene** – `{ id, label, duration, caption, in, out, inMs, outMs, irisIn, irisOut, build(ctx) }`.
`build` returns an SVG string and pushes cues. Scene start times are the running sum of durations,
in array order. Two helpers (from `filmHelpers`) make scenes: `titleCard(id, lines, opts, extra)`
(id becomes `c-<id>`) and `shot(id, buildFn, extra)` (id becomes `s-<id>`); both read `duration` and
`caption` from `TIMING[id]` / `CAPTION[id]`.

**ctx** (passed to `build`) – `{ id, t0, dur, width, height, cues, at(rel) }`.

**Cue** – a plain object (`src/engine/timeline.js`):

| field | meaning |
|---|---|
| `at` | start, **absolute film ms** (use `ctx.at(rel)`) |
| `dur` | duration of ONE iteration, ms (> 0) |
| `target` | a `data-t` name in the markup, or an `Element`. (`'frame'` is the player's picture frame.) |
| `keyframes` | `[{ transform, opacity, visibility, clipPath, ..., offset?, easing? }, ...]` (≥ 2) |
| `easing`, `iterations`, `direction` | as in WAAPI (`iterations` finite) |
| `fill` | default is automatic (see 3.2); `'none'` / `'forwards'` override |
| `reduce` | `'skip'` drops the cue in reduced motion; `'snap'` jumps to its end state; absent = plays normally |

**Target** – any element with `data-t="name"`. A cue animating several CSS properties is split into
one animation per property so chains of cues on the same property don't fight.

**Track** (`src/acting.js`) – remembers an SVG group's pose `{x, y, rot, sx, sy, flip}` and emits
transform cues, filling in the "from" keyframe for you. Poses are absolute and cumulative. A tracked
group animates around its **local origin (0,0)**; art is drawn so the origin is the pivot.

**Effect** – an SVG snippet with a CSS class and `--at` / `--dur` custom properties (`src/fx/effects.js`
+ `effects.css`). Picked up by the timeline through `getAnimations()`, so it shares the clock.

---

## 3. The timeline: timing, effects, playback, pause, seek, replay, reduced motion

Source: `src/engine/timeline.js` (read it; it is ~270 lines with a thorough header comment).

### 3.1 One clock

`createTimeline(root, { duration, cues, reducedMotion })` creates a hidden `<i class="mm-clock">`
and one **master animation** on it with `fill: 'both'`; its `currentTime` *is* the film time.
Every cue is compiled to `element.animate()` and paused; every CSS effect animation found under
`root` is adopted and paused. Playback = `play()` on all of them together; pause = `pause()` on all
of them then re-assert the exact time (pause commits asynchronously and would otherwise drift a frame);
seek = set `currentTime` on all of them. Because everything is a function of the one clock, **the
whole picture is a pure function of time**: seeking forward, backward or by jumping gives
byte-identical frames (this is what `dev/verify.js` fingerprints).

### 3.2 Fill rules (why seeking restores the exact pose)

For each *(element, CSS property)* the earliest cue fills `both` (so it also holds the pose *before*
it starts), later cues fill `forwards`. Result: at any time `t`, every property has exactly the
value the latest finished/running cue gave it. Therefore:

- A Track's first cue should start from the pose you constructed it with; `prospector(...)` and
  `placed(...)` already render that initial pose into the markup.
- If you animate the same element with cues that don't chain through a `Track` (raw cues), keep
  them in time order and non-overlapping per property.

### 3.3 The replaceable-animation trap (already handled, don't undo it)

Browsers silently *remove* a finished animation once a later one overrides the same property. A
removed animation can never be seeked back to, which made eyes and a whole character vanish after a
seek. `compile()` calls `a.persist()` on every cue animation to prevent that. **Do not persist the
adopted CSS animations** (it broke the reduced-motion rebuild).

### 3.4 Effects on the same clock

`.fx` elements (`effects.css`) set `animation-delay: calc(var(--at) * 1ms)`,
`animation-duration: calc(var(--dur) * 1ms)`, `animation-fill-mode: both`. Since `--at` is absolute
film time, an effect appears at the right moment and, when you seek past it, shows its finished
state (invisible), when you seek before it, nothing. The film-look layers in `film-look.css`
(grain, flicker, scratches, specks, gate weave) are looping CSS animations with no delay; they are
adopted the same way, so pausing the movie also freezes the grain, and frame N is always the same
frame N.

### 3.5 Playback state machine

`timeline.state`: `idle → playing ⇄ paused → ended`. `play()` from `ended` rewinds to 0. `seek(t)`
keeps the current state (idle stays idle; ended → paused; seeking to `duration` → ended).
`restart()` = `seek(0)` + `play()`. `skipToEnd()` = `seek(duration)`. Events: `state`, `time`
(every frame while playing, and after seeks), `reducedmotion`.

`play()` only calls `a.play()` on animations whose end is still ahead of the playhead; calling
`play()` on a finished animation rewinds it (that bug existed once).

The **player** adds an `idle` poster frame (the film shows `film.posterAt` ms until first play),
captions, scrub bar (pauses while dragging, resumes after), keyboard (`Space/K`, `←/→` ±5 s,
`Home`, `End`, `R`, `C`, `F`) and the public API (`load, play, pause, toggle, seek, restart, skip,
setCaptions, setReducedMotion, on/off, destroy`). Types: `src/index.d.ts`.

### 3.6 Reduced motion

On by default when `prefers-reduced-motion: reduce` (`reducedMotion: 'auto'`), or via the wave
button, `player.setReducedMotion(bool)`, or `?reduced=1` on the demo page. Toggling **rebuilds the
timeline in place**, keeping the time and play state.

| thing | reduced behaviour |
|---|---|
| cue with `reduce: 'skip'` | dropped (walk cycles, bobs, shakes, idle sway) |
| cue with `reduce: 'snap'` | replaced by an instant jump to its end state (travel, camera moves, transitions) |
| cue with no `reduce` | **plays normally** (right for story-essential things: face swaps, sign pop-ins, ore pops). Title-card text reveals use `snap`: the words appear at once |
| `.fx` particles | hidden (`display:none`) |
| `.fx.fx-keep` (`pow` words, `mark` !/?, `zzz`, `dizzy`, `badIdea`) | kept, but as a plain fade in/out in place (`fx-simple`) |
| film-look (grain, flicker, scratches, weave) | removed; vignette static |

Mechanics worth knowing: the **timeline owns the `is-reduced` class** on the stage and re-collects
the CSS animations right after changing it. Never toggle that class from anywhere else (the player
used to; it spawned effect animations outside the master clock).

---

## 4. Reference: the pieces you build with

### 4.1 `Track` (`src/acting.js`)

```js
const t = new Track(cues, 'name', { x, y, rot, sx, sy, flip });   // pose defaults: 0,0,0,1,1,1
t.to(at, dur, { x: 600 }, { ease, reduce })        // move to a new absolute pose over dur
t.set(at, { y: 540 })                               // instant (1 ms)
t.keys(at, dur, [{ o: .5, y: -40, ease }, { o: 1, y: 0 }], { seg, ease, iterations, reduce })
t.pattern(at, dur, [{ rot: 4 }, { rot: -4 }, { rot: 0 }], opts)   // evenly spaced
t.hop(at, dur, h, { x, y }, opts)                   // arc up by h, land at x/y (default: where it started)
t.p                                                  // the current pose; t.css = inline style for the markup
```

- `o` is the keyframe offset 0..1, the last frame must be `1`. Patches are cumulative.
- A frame's `ease` shapes the segment that leads **into** that frame; `opts.seg` is the default for all segments.
  Default whole-cue easing is `ease-in-out` (or `linear` when you gave `seg`/per-frame eases).
- `flip: -1` mirrors the group horizontally (scale X). Use it for facing left.
- Emit tracks in time order; each cue starts from where the previous cue left the pose.

Also `tween(cues, target, at, dur, from, to, { ease, reduce, iterations })` (any CSS props, e.g. opacity)
and `show(cues, target, at, on = true)` (instant appear/vanish).

### 4.2 Camera and helpers (`src/kit.js`)

```js
const cam = new Camera(cues, id, { x: 640, y: 360, s: 1 });  // wraps the shot; target `${id}.cam`
cam.look(at, dur, { x, y, s }, ease)     // focus point + zoom; reduce:'snap'
cam.shake(at, dur, px, rate)             // decaying shake; reduce:'skip'
return cam.html(`${back}${actors}${fx}`) // everything inside moves with the camera, back-to-front
```

| helper | what |
|---|---|
| `driftClouds(ctx, id)` | drifts `${id}.cloudA/B/C` (the clouds a film's `sky(id)` draws) for the scene |
| `idle(c, from, to, rate)` | breathing sway on a character's `bob`. **`from`/`to` are ABSOLUTE ms: pass `at(0), at(3000)`.** |
| `fwd(c, deg)` | a lean in degrees that respects the character's `flip` (positive = the way it faces) |
| `blow(c, t, up, dn)` | overhead mallet blow; returns the impact time. Character must hold a mallet in `propF`/front hand |
| `popIn(sign, at, x, y)` | a placed prop pops into existence with overshoot |
| `reach(c, x, y, toolLen, prefer?, pose?)` | two-link IK: `{ arm, prop }` rotations for `c.armF` / `c.propF` that put a hand-held tool's tip on world point (x, y). `pose` overrides the root (e.g. `{ x }`) to solve for where it WILL stand |
| `aimAlong(c, at, dur, path, { toolLen, stand?, step?, prefer?, lead? })` | sweeps the tool tip along `path(s) -> {x, y}` (s in 0..1): emits chained arm/tool (and `root.x` via `stand(s)`) cues; returns the tip samples `[{ t, x, y }]` to hang sparks, smoke and flares on |
| `filmHelpers({TIMING, CAPTION})` | returns `{ titleCard, shot, fit }` |

### 4.3 Character rig (`src/art/prospector.js`)

```js
const pip = prospector(cues, `${id}.pip`, {
  kind: 'pip' | 'rex', x, y, scale, flip, rot, face: 'normal', pack: true,
  props: { F: cutter(`${id}.cut`), B: undefined }, armF: -14, armB: 0, hatY: 0,
});
// y is the ground line: the root origin sits between the feet.
return cam.html(`${...}${pip.html}${...}`);
```

Tracks on the returned object (each animates around its natural pivot): `root` (whole body),
`bob` (breathing/hop; use this, not `root`, for hops), `torso`, `head`, `hat`, `armF`, `armB`,
`legF`, `legB`, `shadow`, `propF`, `propB` (the thing in the hand). Actions: `face(at, name)`,
`yap(at, total, rate)` (needs the `'angry'` face), `walk(at, dur, toX, {stride, amp, swing, bounce, ease, toY, noRoot})`,
`squash(at, dur, sy, sx)`, `shake`(head), `vibrate`(body), `fold(at, on)` (arms crossed), `rest(at, dur)`.

Faces (`FACES`): `normal glance shock greed angry plot ko sleep smug cheer sad`; each is a layer and
`face()` swaps opacity instantly, so exactly one is visible at any time (verified).

`walk()` slides `root` to `toX` while swinging limbs and bobbing; limbs return to rest at the end.
`noRoot: true` swings limbs without moving the root (for a walk-in-place or when you move root yourself).

Characters shipped: **pip** (short, round, bearded, scruffy), **rex** (tall, thin, moustache, top hat) and **thief**
(lanky, striped shirt, stubble, flat cap; `kind: 'thief'`). The thief also has `goggles: 'up' | 'down'` (welding goggles
on the cap / over the eyes; swap with `c.goggles(at, 'up' | 'down' | 'off')`) and a `dressed` look, a ridiculous top hat
and a crooked bow tie (`dressed: true`, or `c.dressUp(at, true)`).
Look at them all on `dev/sheet.html`.

### 4.4 Props (`src/art/props.js`)

`ore(variant, s, tone)`, `cutter(id)` (grip at origin, nose +x; its disc is `${id}.disc`),
`mallet()` (grip at origin, head toward +y), `sign(variant 'pip'|'rex', text)` (origin = stake tip),
`cart(id, {loaded})` (+ `cartSpot(i)`, `CART_LOAD_COUNT`, `CART_TOP`; chunk `i` is `${id}.ch${i}`,
wheels `${id}.whB/whF`, body `${id}.body`), `orePile(seed)`, `boulder(w, h)`, `INK` (outline colour),
and `placed(cues, id, markup, pose)` → `{ track, html }`: wraps any markup in a posed, trackable group.

### 4.5 Effects (`src/fx/effects.js`) and title cards (`src/art/cards.js`)

All take **absolute** `at`. Catalogue:

| function | looks like | reduced motion |
|---|---|---|
| `puff({x,y,at,dur,r,dx,dy,opacity,fill})`, `dust({x,y,at,n,spread,r,dur,dir,seed,fill})` | soft drifting puff / cloud of them | hidden |
| `sparks({x,y,at,n,power,dur,angle,spread,seed,size})` | 4-point sparks with gravity | hidden |
| `chips({..., fill})` | dark rock chips (or any colour) | hidden |
| `drops({x,y,at,n,dur,seed,spread})` | flying sweat drops | hidden |
| `rays({x,y,at,n,r0,r1,dur,stroke,width})` | expanding impact rays | hidden |
| `speedLines({x,y,at,dur,total,n,len,dir,spreadY,seed})` | streaks; place INSIDE a moving actor | hidden |
| `sparkle({x,y,at,dur,r,n,s})` | repeating glint (`n` repeats) | hidden |
| `pow({x,y,at,text,dur,rot,scale,font})` | comic word on a starburst: "BONK!" | fades in place |
| `mark({x,y,at,text,dur,size})` | "!" or "?" popping over a head | fades in place |
| `zzz({x,y,at,dur})` | snore Zs | fades in place |
| `dizzy({x,y,at,dur,rx,ry,count})` | orbiting stars | fades in place |
| `badIdea({x,y,at,dur,scale})` | the horned lightbulb | fades in place |
| `flash({at,dur,peak})`, `dim({at,dur,peak})` | full-frame white flash / dark dip. **Put them outside the camera group** or a zoomed/panned camera leaves an edge | hidden |
| `arc({x,y,at,dur,n,r})` | hard strobing welding flare (`n` flickers). Pass it as `torch(id, extra)` and it rides the torch tip | hidden |
| `popBurst({x,y,at,dur,s})` | jagged balloon-pop burst | hidden |
| `lightbulb({x,y,at,dur,scale})` | the *good* idea bulb (no horns) | fades in place |
| `rings({x,y,at,n,gap,dur,r})` | expanding sound rings (a struck bell) | hidden |
| `rng(seed)` | seeded random for deterministic scatter | – |

`FX_DEFS` is the `<defs>` they paint with (`#g-dust`, `#g-smoke`). Put it in your film's `defs`.

### 4.6 Other shared art (film two)

All grayscale, ink-outlined, drawn around a documented origin; each is on `dev/sheet.html`.

| module | what |
|---|---|
| `art/weld.js` | `torch(id, extra)` (grip at origin, `TORCH_TIP`), `gasCart`, `post`, `fenceRun({a,b,ha,hb,n})` (a run along a world line: wrap it in one `<g data-t>` and clip-reveal it), `gate`, `booth(id)` -> `{ back, front }`, `signboard(id, lines)`, `plate(id, w, h, lines)`, `scroll(id)` + `scrollPoint(s)` (a drawable flourish and a point on it by arc length), `swagSack` |
| `art/emerald.js` | `emerald(id, {w,h})` (origin bottom centre; the facets alternate near-white / near-black so it reads as a gem without colour), `plinth`, `stanchion`, `rope`, `placard` |
| `art/balloons.js` | `balloon(tone, s)`, `bird(id)`, `BalloonCloud` (a cloud of balloons tied to a hub in *its carrier's* frame: `releaseRange`, `stretch`, `pop`, `html`) |
| `art/heist.js` | `newspaper`, `bubble`, `dealer`, `coin`, `creditPile`, `creditBag` |
| `art/crowd.js` | `tourist(cues, id, { v, x, y, scale, flip })` -> `{ html, root, bob, head, walk(), awe() }`: one tracked group each, so a queue of 14 stays cheap |

Patterns worth reusing: **reveal** a welded part with a `clipPath: 'inset(0 100% 0 0)' -> 'inset(0 0% 0 0)'` cue on its `<g>` (works on SVG
groups, deterministic, snaps in reduced motion) or draw a path on with `strokeDashoffset 1 -> 0` (give the path `pathLength="1"` and
`stroke-dasharray="1 1"`); **follow a path with a tool** with `aimAlong()` and put the arc, sparks and smoke on the returned samples;
**rig a thing that carries things** (the Emerald with its balloons, rope tail and sling) as one `Track` group so it can rise, squash and fall together.

`card(ctx, lines, opts)` (usually via `titleCard`) draws the black card with a double-rule border and
reveals each line with a staggered fade/rise (`at(120 + i*380)`). `opts.kind`: `'studio'` (reel emblem),
`'title'` (rules + `sub` subtitle), `'end'`, or plain. Line items: a string or `{ t, size, spacing }`.

---

## 5. Creating a new film (step by step)

The shipped `src/films/_template/` is a tiny, working, tested film. Copy it.

```bash
cp -r src/films/_template src/films/rare-or-weld-done
```

1. **Rename identity.** In the copied `index.js`: `id: 'rare-or-weld-done'`,
   `title: 'Rare or Weld Done?'`. Folder name, film `id` and registry id must all match.
2. **Register it** in `src/films/index.js` (one line; the tests fail if `id`/`title` disagree):
   ```js
   { id: 'rare-or-weld-done', title: 'Rare or Weld Done?', load: () => import('./rare-or-weld-done/index.js') },
   ```
3. **Write `config.js`.** `TEXT` (all card strings), `TIMING` (a ms duration for every scene id),
   `CAPTION` (CC text for every scene id; the tests require one per scene).
4. **Write `world.js`.** Export `WORLD_DEFS` = your gradients/patterns **plus `${FX_DEFS}`**, and
   functions returning background SVG. Extend sky/ground *past* the 1280×720 frame if the camera pans
   or zooms (film 1 uses −1200…2480) so you never reveal an edge.
5. **Write scenes** in `scenes/*.js`, one exported function per scene: `(ctx) => svgString`.
   Pattern (from `src/films/that-mines-mine/scenes/discovery.js`):
   ```js
   export function trudge(ctx) {
     const { cues, at, id } = ctx;
     const cam = new Camera(cues, id);
     const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: -160, y: GY, scale: 0.92, pack: true, props: { F: cutter(`${id}.cut`) } });
     pip.walk(at(150), 2350, 440, { stride: 660, amp: 20, bounce: 5, swing: 9 });
     pip.face(at(3500), 'shock');
     const fx = dust({ x: 420, y: GY + 8, at: at(2500), n: 5, spread: 40, r: 26, dir: -1, seed: 4 });
     return cam.html(`${frontBack(id)}${pip.html}${frontFore()}${fx}`);
   }
   ```
6. **Assemble in `index.js`**: `filmHelpers({ TIMING, CAPTION })`, then `scenes: [ titleCard(...), shot(...), ... ]`,
   `chapters: [{ id, label, scene: 's-trudge' }]` (the scene id including its `c-`/`s-` prefix),
   `posterAt` (ms where the idle poster shows a fully revealed title card).
7. **Iterate in the browser:** `npm run dev`, open `http://127.0.0.1:5173/?film=rare-or-weld-done`.
   Useful params: `?t=41000` (paused at 41 s), `?cc=1`, `?reduced=1`, `?ui=0&bare=1` (just the picture).
8. **Verify:** `npm test` then `npm run verify`.

Rules for scene `duration` (in `TIMING`): scene builders schedule inside `0 … duration`. Shortening a
scene trims its tail; lengthening leaves the last pose held. Keep every cue's start inside its scene
(the test enforces it) and end the scene on a held, readable pose.

### 5.1 Scene transitions

`in` / `out`: `'cut'` (default), `'iris'` (circle clip-path from/to `irisIn`/`irisOut` centre, in % of
the frame, e.g. `[50, 62]`), `'fade'` (through black). `inMs` / `outMs` default 520. Title cards fade
(300 ms) unless `{ dialogue: true }`, which cuts in and out like a spoken line. The last scene stays on
screen at `t = duration`. Closing iris-out: see `finale` in `src/films/that-mines-mine/index.js`.

### 5.2 Chapters

`chapters` become `player.chapters` (`[{ id, label, at }]`) and the demo page's jump buttons. Use them
for the story beats. `scene` must be an existing scene id (tests check).

---

## 6. Reusing characters, props, backgrounds, effects

### 6.1 Characters

Use `prospector(cues, id, { kind: 'pip' | 'rex' })` as-is, changing `props`, `scale`, `flip`, `face`,
`pack`, `hatY`. For a **new look**, the options are, smallest first:

1. Different props/hat/face with the existing two bodies (cheapest, always consistent).
2. A new `kind`: add a `KINDS` entry (proportions, face anchor) **and** the body-art functions
   (torso/head/hat) in `src/art/prospector.js`. The body assembly there branches by `kind`
   (`thief` was added as a third body this way: its own leg/torso/head/hat art plus extra opacity-swapped layers); a fourth kind
   means one more branch and its art functions. After touching the rig, film one's `npm test` hash check must stay green.
3. A new rig file `src/art/<name>.js` modelled on `prospector()`. Keep the returned interface (`id`, `html`,
   `root`, `bob`, `head`, `hat`, `armF`, `armB`, `legF`, `legB`, `propF`, `propB`, `face()`, `walk()`, …)
   so `kit.js` helpers (`blow`, `idle`, `fwd`) keep working.

Add every new art asset to `dev/sheet.html` so it can be eyeballed alone.

### 6.2 Props

New props go in `src/art/props.js` as functions returning SVG strings drawn around a meaningful origin
(grip, stake tip, rail …; document it in the header comment). Animate them by wrapping with
`placed(cues, id, markup, pose)` or by putting them into a character's `propF` / `propB` slot
(`props: { F: cutter(id) }`), then animate with `pip.propF.to(...)`. A welding torch, for example: a handheld
prop like `cutter()`, with `sparks()` + `sparkle()` at its tip.

### 6.3 Backgrounds and shared world art

`src/films/that-mines-mine/world.js` holds film 1's locations (`frontBack`, `backWorld`, `caveWall`,
`sunburst`, `cactus`, …). They are **film-1 code**: do not import them from another film. If film 2
really wants one (a desert ground, the comic `sunburst` for reaction close-ups), **promote it** to
`src/art/` (move the function, move any gradient/pattern it uses into a shared defs string, fix film 1's
imports, run the tests: film 1's `build()` output must not change) and import from there.

### 6.4 Smoke, dust, sparks, lighting

- **Dust:** `dust({ x, y, at, n, spread, r, dur, dir, seed })` at a character's feet when they start/stop/land.
  `dir` biases drift (−1 left, +1 right).
- **Smoke / fumes / steam:** there is no separate `smoke()`; use `puff` or `dust` with the dark gradient:
  `puff({ x, y, at, dur: 1400, r: 46, dy: -90, fill: 'url(#g-smoke)' })` (this is what the template does). Use
  light puffs (`#g-dust`, the default) for steam. Stagger several puffs (see the head-steam in
  `rival` in `scenes/rival.js`: four puffs 150 ms apart).
- **Sparks:** `sparks({ x, y, at, n, power, angle, spread, seed, size })`; `angle` is radians (`-Math.PI/2` = up);
  pair with `chips` for debris and `sparkle` for a lingering glint (the mine mouth in `glints()` in `discovery.js`).
- **Lighting:** there is **no lighting system**. The vocabulary is: a soft glow (an ellipse filled with
  `url(#g-glow)` whose opacity you `tween`, see `glitter` in `discovery.js`; film 1 defines `#g-glow` in its
  `WORLD_DEFS`, so add it to yours), `flash()` (impact frame) and `dim()` (dramatic dip), `sparkle()`
  glints, and the CSS vignette/flicker. A welder's arc would be a `#g-glow` ellipse + `flash` + `sparks`.
- **`flash`/`dim`** are full-frame rects. Film 1 puts them inside `cam.html()`, which works while the camera
  is zoomed in (≥ 1) near the middle; for exactness put them *outside* the camera group:
  `return `${cam.html(...)}${flash({...})}``.

---

## 7. New scenes and coordinating several animated characters

Study `src/films/that-mines-mine/scenes/rival.js` (the sign-swapping routine) and `bonk.js`. The
technique, in order:

1. **Fix the staging numbers first** as constants (`GY = 604` ground line, `SIGN_Y`, x positions). Every
   character's `y` is its ground line; stand characters on the same one.
2. **Create everything up front** (`prospector`, `placed`, `Camera`), each with a unique `${id}.name`.
3. **Write the action as a timeline of comments**, `at(ms)` ascending, one block per beat. All characters
   share the one `cues` list, so "Rex reacts at 1400 ms" and "Pip wakes at 3300 ms" are just numbers on the
   same axis. Sync an effect to an action by *using the returned time*: `const hit1 = blow(rex, at(2700));`
   → `R1.track.to(hit1, 90, { y: 578 })` and `pow({ at: hit1 + 20 })`. Never duplicate a number you can derive.
4. **Overlap, don't sequence**: while one character winds up, another can idle or react. A single call per
   body part per moment; later cues on the same Track continue from the previous pose.
5. **Props are actors too.** Signs are `placed()` Tracks: pop in with `popIn`, sink with `.to(..., { y })` on
   each blow, get yanked with `.keys(..., { rot })` and flung off-screen with a two-segment arc.
6. **Z-order is the order in the returned string**: background → set dressing → props → characters →
   foreground that overlaps feet (`frontFore()`) → effects. Effects go last so they're never hidden.
7. **Direct attention with the camera, not by moving characters:** `cam.look(at, dur, { x, y, s })`.
   The argument scenes zoom toward the speaker in small steps (`punch(t, f)` in `argue1`/`argue2`); an
   earlier version made characters hop upward and they ended up floating. Zoom instead.
8. **Hold the last pose.** Leave a beat after the last action so the gag lands (1:09 in film 1 felt rushed
   until its tail was extended). People need ~1 s to read a new picture.
9. **Close-ups**: scale the character (`scale: 2.7` in `idea`) on a backdrop (`sunburst`) rather than zooming
   a wide set; fewer elements, cleaner read.

Multi-scene continuity: a character in scene B is a *new* `prospector(...)` call. Put it in the pose the
previous scene ended in (same `x`, `face`, `props`), and use a transition (iris/fade/title card) so the
cut hides the join.

---

## 8. Title cards, dialogue and visual gags

### 8.1 Title cards

```js
// config.js
TEXT.work = ['NOTHING BEATS A DAY', 'OF HONEST WORK!'];   TIMING.work = 3200;   CAPTION.work = '...';
// index.js
titleCard('work', TEXT.work),                               // fades through black
titleCard('thatMine', TEXT.thatMine, { dialogue: true }),   // cuts in/out: a spoken line
titleCard('end', TEXT.end, { kind: 'end', size: 120 }, { inMs: 700, outMs: 0, out: 'cut' }),
```

- Auto size (`fit()` in `kit.js`) = the largest serif that keeps the longest line inside the border,
  capped at 96, min 40. It assumes ~0.66 em per character of a heavy serif; with a different font, re-check
  long lines at small widths.
- **Duration rule that survived feedback:** about **1 s plus 0.4 s per word**. Film 1 shipped with cards
  that were too short and was lengthened; the cards fade in line by line (`120 + i*380` ms) and out (300 ms),
  so the fully-readable window is a bit shorter than the scene. Test by reading it once, slowly.
- Keep it to ≤ 2 lines, ≤ ~28 characters a line. Studio card / title card use per-line `{ t, size, spacing }`
  items and a `kind` (see `index.js` in film 1).
- A new card *style* (different border, a vignette, an iris-shaped inset) is a new `kind` branch in
  `src/art/cards.js`.

### 8.2 Gags (anatomy and recipes)

A visual gag needs **setup → tell → payoff → hold**, in separate beats, and each should read with the
sound off. Film 1's reusable devices:

| gag | how it is built |
|---|---|
| double-take | `face('glance')` → look away → `face('shock')` + `head` snap + `bob.hop` + `mark('!')` + `drops()` |
| impact | `flash` (200 ms) + `pow('BONK!')` + `rays` + `sparks` + `chips` + `dizzy` + `cam.shake`, all keyed to one impact time |
| "very bad idea" | close-up on a sunburst, eyes `glance` at the tool, `badIdea()` bulb, `plot` face, `vibrate()` |
| escalating load | cart with 28+ ore chunks `popped` in `FILL_ORDER` at 52 ms apart (`cartFull` in `mining.js`) |
| runaway object | the prop's `Track` eases in (`cubic-bezier(.55,.05,1,.7)`), wheels spin by the distance travelled, debris `flyer()`s shed behind it |
| foreshadow | the cutter that Pip hammers a sign with in `rival` (butt end) is the thing that bonks later |
| sign war | `placed()` signs that pop/sink/fly; same object three times with different outcomes |
| punchline picture | final wide shot that restates the joke visually (rival on the ore pile with the MINE! flag), then the card |
| hat reunion | a `hat` Track dropped from off-screen (`hatY: -1500`) lands on a head that doesn't notice |
| jump-kick that changes nothing (film 2) | crouch (hold it) -> accelerating run (`cubic-bezier(.65,0,.9,.5)`, legs/arms keyed fast) -> one `root` cue arcing to `rot: -84` with `y` raised (feet at the origin = the pivot) -> 1-frame `flash` + `rings` + `pow` while the target shudders (`x` +/- decaying, `sx`) -> a spinning rebound whose `rot` runs a full extra turn, then `set` it back to the equivalent angle before the recovery |
| escalating load + cascade (film 2) | `BalloonCloud`: tie on 1, 3, 8, 18; `stretch` them, then `pop` in a shuffled order with the gap shrinking (`gap *= .78`, floor 22 ms); the carrier falls on one accelerating `keys` cue |
| a tool that welds a path (film 2) | `aimAlong()` + a `strokeDashoffset` cue on the kerf over the same duration + `arc` windows inside the torch + sparks/smoke on the returned samples |
| the squeeze (film 2) | squash the whole load group (`sy: .3`) into the opening, ooze it through, then a `boing`: `sy 1.34 / sx .84 -> .9 / 1.08 -> 1` |

When you need a **new animated device**, build it from `Track` + existing effects first. If it needs a
new particle or symbol, add a generator in `effects.js` and a `@keyframes` + class in `effects.css`:
use `.fx` (it already wires `--at`, `--dur`, `--n`, fill-mode), pass extra `--vars` through the style
string, decide whether it's `fx-keep` (story symbol) or decoration, and add a unit test in
`test/engine.test.mjs`.

---

## 9. Testing a new film

Layers, cheapest first. All of them must pass; the last one is you.

### 9.1 `npm test` (≈ 0.2 s, Node only, no browser)

`test/films.test.mjs` runs against **every registered film**: metadata equals the registry; `build()` is
deterministic; scenes are contiguous and captioned; chapters resolve; every cue is finite and inside the
film; **every cue target exists in the markup** (a typo is otherwise silent); every `url(#id)` resolves
(forgot `FX_DEFS`); no `data-t` name is shared between scenes; **every cue starts inside the scene that
owns its target** (forgot `at()`); **no two cues overlap on the same element property** (rule 11; the approved
film one is exempt). `test/film1-approved.test.mjs` pins film one's build output to the `film1-approved` tag's
hashes, so a shared-library change that alters the approved picture fails loudly. `test/engine.test.mjs` unit-tests `Track` (including the `hop` landing
regression), `defineFilm`, effects and the SSR-safe import. `test/docs.test.mjs` checks that file paths
and `npm run` commands named in the docs exist.

### 9.2 `npm run verify` (≈ 15 s for the 100-second film, headless Chrome, zero dependencies)

Runs `dev/verify.html` for each film in the registry (or `node dev/verify-headless.mjs <id>`). Needs
Node ≥ 22 and Chrome/Chromium (`CHROME_BIN=…` to point at one). Checks, in the real engine:

- no "cue target not found" warnings; poster frame state
- **seek determinism**: the whole picture's fingerprint at ~130 sample times (every scene boundary ±1 ms,
  midpoints) is identical arriving forward, backward and by shuffled jumps
- exactly **one scene visible** at every boundary; exactly **one face** visible per character
- API semantics: seek keeps paused/playing; idle → paused; `skip()` equals `seek(duration)`
- **pause freezes every animation** (none `running`, picture unchanged); playback tracks wall-clock
- natural end, replay, `restart()` give identical frames
- **reduced motion**: rebuilds in place, hides decoration, seek is order independent, toggling back
  restores the identical picture
- `load()` twice leaks no animations and keeps the film-look layers alive; `destroy()` cancels everything
- **mobile (375 px wide player)**: 16:9, controls fit, no horizontal overflow

Open it by hand for a visual report: `npm run dev` → `http://127.0.0.1:5173/dev/verify.html?film=<id>`.
When a fingerprint differs, bisect in the browser console: take `getComputedStyle` of every `[data-t], .fx`
at the two times and diff them; the element named in the diff is the culprit.

### 9.3 Manual checklist (do all of it, in a real browser)

- [ ] **Seeking:** drag the scrub bar across the whole film; jump to each chapter; with `?t=` open every scene
      boundary. No missing characters, no stuck faces, no leftover effects, no flicker of the wrong scene.
- [ ] **Replay:** let it end, press replay; press restart mid-film; skip to end; scrub backward. Same pictures.
- [ ] **Pause/resume:** pause mid-gag (the grain should freeze too), wait, resume; nothing jumps.
- [ ] **Scene transitions:** every iris/fade/cut; first frame and last frame of every scene (`?t=<start>`, `<end-1>`).
- [ ] **Titles:** read each card at normal speed. Captions (`?cc=1`) say what the picture says.
- [ ] **Mobile:** viewport 375×812 (and ~700 px for a "panel"): picture, controls and chapter buttons fit,
      thumb-size targets, scrub on its own row. Fullscreen works.
- [ ] **Reduced motion:** `?reduced=1`: still readable as a story (cards, expressions, signs, impact words), no
      decoration or camera shake.
- [ ] **No console warnings** (`[movie] cue target not found`).

### 9.4 Screenshots and the hidden-pane gotcha

Seeking does not need a ticking clock, so `?t=…&bare=1&ui=0` + a screenshot is the quickest way to review
a frame. **Real playback needs a *visible* page**: in a backgrounded/hidden pane or tab the clock appears
frozen. In the Claude desktop app, bring the preview pane forward before judging playback.

---

## 10. Packaging for RuneSpace

The deliverable is the `src/` folder (about 480 KB of source for the two films, about 145 KB packed). It has **no dependencies, no build
step, no network, no storage, no audio, no globals**.

### 10.1 Two ways in

**Vendor it** (simplest): copy `src/` into the app, e.g. `features/theatre/movies/`, and import the
three stylesheets once.

**Pack it:** `npm run pack:check` lists the tarball; `npm pack` produces `runespace-movies-<version>.tgz`
(only `src/` + docs; dev tools and tests are excluded). `package.json` `exports` maps `.`,
`./player.css`, `./effects.css`, `./film-look.css`, `./films/*`.

### 10.2 Mounting in a Next.js / React client component

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
    let player: MoviePlayer | undefined;
    let off: (() => void) | undefined;
    let cancelled = false;
    loadFilm(filmId).then((film) => {            // lazy: only this film is fetched
      if (cancelled || !host.current) return;
      player = createMoviePlayer(host.current, { film });
      off = player.on('state', (s) => s === 'ended' && onEnd?.());
    });
    return () => { cancelled = true; off?.(); player?.destroy(); };   // StrictMode-safe
  }, [filmId, onEnd]);
  return <div ref={host} />;
}
```

Notes:

- **SSR:** importing the barrel is safe in Node (tested). `createMoviePlayer`/`createTimeline` need `document`
  so call them in an effect, as above.
- **Bundle size:** `src/index.js` still has the legacy static `thatMinesMine` export, so importing the barrel
  bundles film 1. Prefer `loadFilm(id)` (dynamic import per film) and, if you want zero film code in the
  barrel, import from `.../src/player/player.js` and `.../src/films/index.js` directly.
- **Sizing:** the player is `width: 100%` at the film's aspect ratio (`--mm-aspect`). Size it with its container.
  Its mobile layout follows the *player's* width (CSS container query), so a narrow panel on a wide screen works.
- **Reduced motion:** leave `'auto'`, or pass RuneSpace's own setting and call `player.setReducedMotion(v)` on change.
- **Theming:** CSS custom properties on `.mm-player` (`--mm-accent`, `--mm-bar-bg`, `--mm-fg`, `--mm-muted`, `--mm-radius`).
  Headless: `controls: false` and drive it with `player.play()/pause()/seek()` and `player.on('state' | 'time' | 'scene')`.
- **Fonts:** title cards use a system serif stack (`Playfair Display, Bodoni MT, Didot, Georgia, …`) and impact words
  use `Impact`. Nothing is downloaded. If the host loads Playfair Display the cards will match the intended look.
- **Game hooks** (tickets, buffs, "watched") do not exist here. The host listens to `state === 'ended'` etc.
- **Browser support:** developed and verified in Chromium (Chrome 154). Uses Web Animations
  (`persist()`, `getAnimations({subtree:true})`), `clip-path`, `@container`, `aspect-ratio`; all current evergreen
  browsers. Firefox/Safari are untested here.

### 10.3 Checklist before handing a film to the host

- [ ] `npm test` and `npm run verify` green; manual checklist (9.3) done
- [ ] `src/films/index.js` entry added; `id` matches
- [ ] `src/index.d.ts` unchanged API (or updated); `README.md` film list updated
- [ ] `git status` clean, committed; `npm run pack:check` shows only `src/` and docs

---

## 11. Constraints and pitfalls (each of these has already bitten someone)

1. **Absolute vs relative time.** Cue `at` and effect `at` are absolute film ms. Use `ctx.at()` everywhere,
   including arguments you pass to helpers (`idle(pip, at(0), at(3300))`, not `idle(pip, 0, 3300)`).
   Film 1 has two of these slips (see NEXT_FILM_HANDOFF.md → Known issues); the tests allow-list exactly those two.
2. **`hop()` must land.** `Track.hop` returns to its starting y; chaining the old accumulating version made
   characters float upward. Use `pip.bob.hop(...)` (not `pip.root`) for jumps so the root's ground line is untouched.
3. **Never `setTimeout`/rAF for anything visual.** It will not pause or seek.
4. **Never toggle `.is-reduced` yourself.** The timeline owns it.
5. **Don't cancel adopted animations.** `timeline.destroy()` cancels only its own cue animations; the CSS ones
   (including the player's grain/flicker/weave) are handed back. Cancelling them kills the film look permanently.
6. **Don't remove `persist()`** in `compile()` (finished animations get garbage-collected and can't be seeked back).
7. **`play()` on a finished animation rewinds it.** The timeline guards `resume()`; keep the guard.
8. **Replaceable-animation fill rules.** Don't give two overlapping raw cues to the same property of one element.
9. **Unique names.** `data-t` must be unique per film and prefixed with the scene id. Targets are looked up by
   name; duplicates animate together.
10. **CSS effects must be deterministic functions of time** (finite or looping keyframes using `--at`/`--dur`).
    Random-looking scatter must come from `rng(seed)` at build time, never `Math.random()`.
    `build()` must be deterministic; the tests build twice and compare.
11. **Pivots live at the group origin.** Group art so (0,0) is the joint/grip/feet; rotate/scale then behave.
    Characters: the root origin is between the feet; `y` is the ground line.
12. **Facing:** `flip: -1` faces left. Leans/rotations use `fwd(c, deg)` so they follow the facing.
13. **Reduced motion is opt-out per cue.** Add `reduce: 'skip'` to decoration and `'snap'` to travel; check `?reduced=1`.
14. **Camera extents.** Backgrounds must extend past the frame in the directions the camera can pan/zoom (the finale once
    revealed the world's edge). The player overscans the SVG by 0.6 % so gate weave never shows a border.
15. **Last frame.** The last scene must stay visible at `t = duration`; `defineFilm` handles it, but the last
    scene's cues must not rely on a later scene.
16. **Perf budget.** Film 1: ~800 cues, ~1,350 live animations, ~100 s; fine on desktop and a phone emulator. If a
    scene needs hundreds more (confetti), prefer CSS `.fx` effects over cues, and measure on a mid-range phone.
17. **Fonts differ by OS.** Re-check the longest card line and `pow()` words on a non-Mac/Windows system.
18. **Hidden page = frozen clock** (9.4).
19. **Don't import across films; don't edit film 1.** `git tag film1-approved` is the reference; the tests plus
    `npm run verify` must stay green for it after any engine change.
20. **Keep it dependency-free.** No GSAP, no framework, no build step. Anything that needs one belongs in the host.
21. **Don't overlap cues on a Track** (rule 11). It is the easiest bug to write: `walk()` plus a `bob.to()` in the same
    window, a `camera.look()` that overlaps a `shake()` (the shake is cut and the camera snaps to the look's pose), two `keys()`
    on a group that must both end in one cue. Merge them into one cue, move one to another Track, or sequence them.
    A looping decoration (`iterations`) counts for its whole length.
22. **Full-frame effects go outside the camera group.** `flash()` / `dim()` are rects at the origin: inside a panned or zoomed
    `cam.html()` they leave an edge. `return `${cam.html(...)}${flash(...)}``.
23. **Rotations that turn through more than 180 degrees**: keys interpolate the numbers you give. A spin of -372 deg is a full
    turn and a bit; afterwards `set()` the equivalent small angle (-12) before animating again, or the next cue unwinds the spin.
24. **Poses of a cartoon "sit" and "lie" are just rotations about the feet** (the root origin is between the feet): a seated
    thief is `legF/legB.rot = -90` plus `bob.y = +hip height`; a flying kick is `root.rot = -84` with `y` raised.

---

## 12. Quick API cheat sheet

```js
// player
import { createMoviePlayer, loadFilm, listFilms, FILMS } from './src/index.js';
const player = createMoviePlayer(el, { film, controls: true, captions: false, reducedMotion: 'auto', autoplay: false, keyboard: true });
player.play(); player.pause(); player.toggle(); player.seek(ms); player.restart(); player.skip();
player.load(film); player.setCaptions(bool); player.setReducedMotion(bool); player.destroy();
player.state /* 'idle'|'playing'|'paused'|'ended' */; player.time; player.duration; player.scenes; player.chapters;
const off = player.on('state' | 'time' | 'scene' | 'load', fn);

// engine
import { createTimeline, defineFilm } from './src/index.js';
const tl = createTimeline(rootEl, { duration, cues, reducedMotion }); // tl.play/pause/seek/restart/skipToEnd/setReducedMotion/destroy; tl.on('state'|'time'|'reducedmotion')

// authoring
import { Track, tween, show } from './src/acting.js';
import { Camera, driftClouds, idle, fwd, blow, popIn, reach, aimAlong, filmHelpers } from './src/kit.js';
import { prospector } from './src/art/prospector.js';
import { cutter, mallet, sign, cart, orePile, boulder, ore, placed } from './src/art/props.js';
import { puff, dust, sparks, chips, drops, rays, speedLines, sparkle, pow, mark, zzz, dizzy, badIdea, lightbulb, arc, popBurst, rings, flash, dim, rng, FX_DEFS } from './src/fx/effects.js';
import { torch, fenceRun, booth, signboard, plate } from './src/art/weld.js';
import { emerald } from './src/art/emerald.js';
import { BalloonCloud, bird } from './src/art/balloons.js';
import { tourist } from './src/art/crowd.js';
```

Commands: `npm run dev` · `npm test` · `npm run verify` · `npm run pack:check` · `node dev/verify-headless.mjs <film-id>`.
