// Unit tests for the engine's pure parts: acting.js (Track), engine/film.js (defineFilm),
// fx/effects.js (markup generators) and the SSR-safety of the public entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Track, tween, show } from '../src/acting.js';
import { defineFilm, TRANSITION_MS } from '../src/engine/film.js';
import { puff, dust, sparks, pow, flash, rng, arc, popBurst, lightbulb, rings, FX_DEFS } from '../src/fx/effects.js';
import { Camera, reach, aimAlong } from '../src/kit.js';
import { prospector, FACES } from '../src/art/prospector.js';
import { BalloonCloud } from '../src/art/balloons.js';
import { scrollPoint, TORCH_TIP, torch, fenceRun, signboard } from '../src/art/weld.js';
import { tourist } from '../src/art/crowd.js';

test('Track: poses are absolute and cumulative; each move starts where the last ended', () => {
  const cues = [];
  const t = new Track(cues, 'a', { x: 10, y: 20 });
  t.to(100, 200, { x: 50 }).to(400, 100, { y: 0 });
  assert.equal(cues.length, 2);
  assert.equal(cues[0].keyframes[0].transform, 'translate(10px, 20px) rotate(0deg) scale(1, 1)');
  assert.equal(cues[0].keyframes[1].transform, 'translate(50px, 20px) rotate(0deg) scale(1, 1)');
  assert.equal(cues[1].keyframes[0].transform, 'translate(50px, 20px) rotate(0deg) scale(1, 1)', 'second cue starts at the first one\'s end pose');
  assert.deepEqual({ x: t.p.x, y: t.p.y }, { x: 50, y: 0 });
});

test('Track: flip mirrors horizontally via scaleX', () => {
  assert.match(Track.tf({ x: 0, y: 0, rot: 0, sx: 2, sy: 3, flip: -1 }), /scale\(-2, 3\)/);
});

test('Track.hop returns to the starting ground line (regression: characters used to float up)', () => {
  const cues = [];
  const t = new Track(cues, 'a', { x: 0, y: 100 });
  for (let i = 0; i < 5; i++) t.hop(i * 1000, 400, 30);
  assert.equal(t.p.y, 100, 'five hops later it is still on the ground');
  const last = cues.at(-1).keyframes.at(-1).transform;
  assert.match(last, /translate\(0px, 100px\)/);
  const peak = cues.at(-1).keyframes[1].transform;
  assert.match(peak, /translate\(0px, 70px\)/, 'the apex is `h` above the start');
});

test('Track.keys: per-frame ease shapes the segment INTO that frame', () => {
  const cues = [];
  new Track(cues, 'a').keys(0, 1000, [{ o: 0.5, x: 10, ease: 'ease-out' }, { o: 1, x: 0 }]);
  const kf = cues[0].keyframes;
  assert.equal(kf[0].easing, 'ease-out');
  assert.equal(kf[1].easing, undefined);
});

test('tween / show push plain cues', () => {
  const cues = [];
  tween(cues, 'g', 5, 10, { opacity: 0 }, { opacity: 1 });
  show(cues, 'g', 20, true);
  show(cues, 'g', 30, false);
  assert.deepEqual(cues.map((c) => [c.at, c.dur]), [[5, 10], [20, 1], [30, 1]]);
  assert.deepEqual(cues[1].keyframes, [{ opacity: 0 }, { opacity: 1 }]);
  assert.deepEqual(cues[2].keyframes, [{ opacity: 1 }, { opacity: 0 }]);
});

test('Camera: pose is focus + zoom around the frame centre; look() emits a snap-in-reduced-motion cue', () => {
  const cues = [];
  const cam = new Camera(cues, 's');
  assert.equal(cam.target, 's.cam');
  assert.deepEqual([cam.p.x, cam.p.y, cam.p.sx], [0, 0, 1]);
  cam.look(0, 500, { x: 500, y: 400, s: 2 });
  assert.deepEqual([cam.p.x, cam.p.y, cam.p.sx], [640 - 1000, 360 - 800, 2]);
  assert.equal(cues[0].reduce, 'snap');
  assert.match(cam.html('<g/>'), /data-t="s\.cam"/);
});

test('prospector: exposes tracks and registers exactly one visible face', () => {
  const cues = [];
  const pip = prospector(cues, 'x.pip', { kind: 'pip', face: 'greed' });
  assert.equal(pip.id, 'x.pip');
  const faces = [...pip.html.matchAll(/data-t="x\.pip\.f\.(\w+)" style="opacity:(\d)"/g)];
  assert.equal(faces.length, 11);
  assert.deepEqual(faces.filter((m) => m[2] === '1').map((m) => m[1]), ['greed']);
  pip.face(100, 'shock');
  assert.equal(cues.length, 2, 'a face swap = one fade-out + one fade-in cue');
});

test('defineFilm: scene starts are the running sum; iris/fade emit frame cues; last shot holds', () => {
  const film = defineFilm({
    id: 'x', title: 'X', defs: '<g id="d"/>',
    chapters: [{ id: 'c', label: 'C', scene: 'b' }],
    scenes: [
      { id: 'a', duration: 1000, caption: 'A', build: () => '<g/>', out: 'fade' },
      { id: 'b', duration: 2000, caption: 'B', build: () => '<g/>', in: 'iris', irisIn: [10, 20], out: 'iris', irisOut: [30, 40] },
      { id: 'c', duration: 500, caption: 'C', build: () => '<g/>' },
    ],
  });
  const b = film.build();
  assert.equal(b.duration, 3500);
  assert.deepEqual(b.scenes.map((s) => [s.id, s.start, s.end]), [['a', 0, 1000], ['b', 1000, 3000], ['c', 3000, 3500]]);
  assert.deepEqual(b.chapters, [{ id: 'c', label: 'C', at: 1000 }]);
  assert.match(b.markup, /^<defs><g id="d"\/><\/defs>/);
  const frame = b.cues.filter((c) => c.target === 'frame');
  assert.ok(frame.some((c) => c.at === 1000 - TRANSITION_MS && c.keyframes[1].opacity === 0), 'fade-out of scene a');
  assert.ok(frame.some((c) => c.at === 1000 && /circle\(0% at 10% 20%\)/.test(c.keyframes[0].clipPath)), 'iris-in centred at irisIn');
  assert.ok(frame.some((c) => c.at === 3000 - TRANSITION_MS && /circle\(0% at 30% 40%\)/.test(c.keyframes[1].clipPath)), 'iris-out centred at irisOut');
  const holds = b.cues.filter((c) => c.target === 'c' && c.keyframes[0].visibility);
  assert.equal(holds[0].fill, 'forwards', 'the final shot stays visible at t = duration');
  assert.equal(b.cues.find((c) => c.target === 'a' && c.keyframes[0].visibility).fill, 'none');
});

test('defineFilm: ctx.at() converts scene-relative to absolute time', () => {
  let seen;
  defineFilm({ id: 'x', title: 'X', scenes: [
    { id: 'a', duration: 700, build: () => '' },
    { id: 'b', duration: 900, build: (ctx) => { seen = ctx; return ''; } },
  ] }).build();
  assert.equal(seen.at(250), 950);
  assert.equal(seen.dur, 900);
  assert.equal(seen.id, 'b');
});

test('effects: markup carries absolute --at / --dur, the CSS class, and is deterministic', () => {
  const p = puff({ x: 1, y: 2, at: 4321, dur: 777 });
  assert.match(p, /fx-puff/);
  assert.match(p, /--at:4321/);
  assert.match(p, /--dur:777/);
  assert.equal(dust({ x: 0, y: 0, at: 0, seed: 3 }), dust({ x: 0, y: 0, at: 0, seed: 3 }));
  assert.notEqual(dust({ x: 0, y: 0, at: 0, seed: 3 }), dust({ x: 0, y: 0, at: 0, seed: 4 }));
  assert.match(sparks({ x: 0, y: 0, at: 0 }), /fx-spark/);
  assert.match(pow({ x: 0, y: 0, at: 0, text: 'ZAP!' }), /ZAP!/);
  assert.match(pow({ x: 0, y: 0, at: 0 }), /fx-keep/, 'pow survives reduced motion');
  assert.match(flash({ at: 1 }), /fx-flash/);
  assert.match(puff({ x: 0, y: 0, at: 0, fill: 'url(#g-smoke)' }), /url\(#g-smoke\)/);
});

test('FX_DEFS declares the gradients the effects paint with', () => {
  assert.match(FX_DEFS, /id="g-dust"/);
  assert.match(FX_DEFS, /id="g-smoke"/);
  assert.match(puff({ x: 0, y: 0, at: 0 }), /url\(#g-dust\)/, 'puff default fill is #g-dust');
});

test('rng is seeded and repeatable', () => {
  const a = rng(5); const b = rng(5);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('the public entry imports in plain Node (no document / window needed: SSR-safe)', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const api = await import('../src/index.js');
  for (const k of ['createMoviePlayer', 'createTimeline', 'defineFilm', 'loadFilm', 'listFilms', 'FILMS', 'thatMinesMine']) {
    assert.ok(k in api, `missing export ${k}`);
  }
});

/* ------------------------------------------------------------ additions for "Rare or Weld Done?" */

test('fx: welding arc, balloon pop burst, lightbulb and rings are deterministic CSS effects on the master clock', () => {
  const a = arc({ x: 1, y: 2, at: 500, dur: 130, n: 4, r: 30 });
  assert.match(a, /class="fx fx-arc fx-late"/);
  assert.match(a, /--at:500;--dur:130;--n:4/);
  assert.equal(a, arc({ x: 1, y: 2, at: 500, dur: 130, n: 4, r: 30 }), 'same inputs give the same markup');
  assert.match(popBurst({ x: 0, y: 0, at: 10 }), /class="fx fx-popburst"/);
  assert.match(lightbulb({ x: 0, y: 0, at: 10 }), /fx-bulb fx-keep/, 'the lightbulb is a story symbol: it survives reduced motion');
  assert.equal((rings({ x: 0, y: 0, at: 0, n: 3 }).match(/fx-ring/g) || []).length, 3);
});

test('thief rig: goggles and top hat swap by opacity cues, and exactly one face is shown', () => {
  const cues = [];
  const th = prospector(cues, 't', { kind: 'thief', goggles: 'up' });
  for (const f of FACES) assert.match(th.html, new RegExp(`data-t="t\\.f\\.${f}"`));
  th.goggles(100, 'down');
  th.goggles(200, 'off');
  th.dressUp(300, true);
  const byTarget = (name) => cues.filter((c) => c.target === name).map((c) => [c.at, c.keyframes[0].opacity, c.keyframes[1].opacity]);
  assert.deepEqual(byTarget('t.gUp'), [[100, 1, 0]]);
  assert.deepEqual(byTarget('t.gDown'), [[100, 0, 1], [200, 1, 0]]);
  assert.deepEqual(byTarget('t.cap'), [[300, 1, 0]]);
  assert.deepEqual(byTarget('t.top'), [[300, 0, 1]]);
  assert.deepEqual(byTarget('t.bow'), [[300, 0, 1]]);
  th.dressUp(300, true); // idempotent
  assert.equal(cues.filter((c) => c.target === 't.top').length, 1);
});

test('reach(): the two-link solution puts the tool tip on the target, whichever way the character faces', () => {
  const rad = Math.PI / 180;
  for (const flip of [1, -1]) {
    const c = prospector([], 't', { kind: 'thief', x: 400, y: 600, scale: 0.95, flip });
    const k = c.dims;
    for (const [dx, dy] of [[110, -60], [90, -20], [120, -100], [140, -20]]) {
      const tx = 400 + flip * dx;
      const ty = 600 + dy;
      const { arm, prop } = reach(c, tx, ty, TORCH_TIP.x);
      const hx = k.sh - k.armL * Math.sin(arm * rad);
      const hy = -k.L - k.T + k.shY + k.armL * Math.cos(arm * rad);
      const px = hx + TORCH_TIP.x * Math.cos((arm + prop) * rad);
      const py = hy + TORCH_TIP.x * Math.sin((arm + prop) * rad);
      const wx = 400 + flip * 0.95 * px;
      const wy = 600 + 0.95 * py;
      assert.ok(Math.hypot(wx - tx, wy - ty) < 0.5, `flip ${flip}: tip (${wx.toFixed(1)}, ${wy.toFixed(1)}) should be (${tx}, ${ty})`);
    }
  }
});

test('aimAlong(): returns the sampled tip points and emits chained arm cues that never overlap', () => {
  const cues = [];
  const c = prospector(cues, 't', { kind: 'thief', x: 400, y: 600, scale: 0.95 });
  const tips = aimAlong(c, 1000, 600, (s) => ({ x: 500 + 40 * s, y: 520 }), { toolLen: TORCH_TIP.x, step: 100, lead: 200 });
  assert.equal(tips.length, 7);
  assert.deepEqual([tips[0].t, tips.at(-1).t], [1000, 1600]);
  assert.deepEqual([tips[0].x, tips.at(-1).x], [500, 540]);
  const arm = cues.filter((x) => x.target === 't.armF');
  assert.deepEqual(arm.map((x) => [x.at, x.dur]), [[800, 200], [1000, 600]]);
});

test('scrollPoint(): walks the flourish by arc length (constant speed) from its start to its end', () => {
  assert.deepEqual([scrollPoint(0).x, scrollPoint(0).y], [0, 0]);
  const e = scrollPoint(1);
  assert.deepEqual([Math.round(e.x), Math.round(e.y)], [12, -58]);
  const steps = [];
  let prev = scrollPoint(0);
  for (let i = 1; i <= 20; i++) {
    const p = scrollPoint(i / 20);
    steps.push(Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = p;
  }
  assert.ok(Math.max(...steps) / Math.min(...steps) < 1.6, 'even spacing: a torch following it moves at a steady speed');
});

test('BalloonCloud: balloons tie on, stretch, and pop; every cue target exists in its markup', () => {
  const cues = [];
  const cloud = new BalloonCloud(cues, 'b', { hub: { x: 0, y: -100 }, count: 6, seed: 3 });
  cloud.releaseRange(0, 3, 100, 50);
  cloud.stretch(1000, 300, 1.4);
  cloud.pop(1, 1500);
  const html = cloud.html;
  const names = new Set([...html.matchAll(/data-t="([^"]+)"/g)].map((m) => m[1]));
  for (const c of cues) assert.ok(names.has(c.target), `${c.target} is in the markup`);
  assert.match(html, /fx-popburst/);
  assert.equal(cloud.live.size, 2, 'three tied on, one popped');
  const placedCloud = new BalloonCloud([], 'p', { count: 4, placed: true });
  assert.equal(placedCloud.live.size, 4, 'placed: every balloon is already floating');
});

test('tourist(): one tracked group; walk() slides the root and hops the body; awe() swaps the mouth once', () => {
  const cues = [];
  const t = tourist(cues, 'x', { v: 9, x: 100, y: 600 });
  assert.match(t.html, /data-t="x"/);
  assert.match(t.html, /data-t="x\.bob"/);
  assert.match(t.html, /data-t="x\.head"/);
  t.walk(0, 800, 300);
  assert.equal(t.root.p.x, 300);
  const n = cues.length;
  t.awe(900);
  t.awe(950);
  assert.equal(cues.length, n + 4, 'awe() is idempotent: mouth swap (2) + head tilt + hop');
});

test('props: fence runs and signs are plain markup with per-line groups for reveals', () => {
  assert.match(fenceRun({ a: [0, 100], b: [200, 100], n: 5 }), /<path/);
  const sb = signboard('s', ['A', 'B', 'C']);
  for (const i of [0, 1, 2]) assert.match(sb.html, new RegExp(`data-t="s\\.l${i}"`));
  assert.equal(sb.lineY.length, 3);
  assert.match(torch('tc', '<g id="flare"/>'), /id="flare"/, 'extra markup rides at the torch tip');
});
