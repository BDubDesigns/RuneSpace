// Unit tests for the engine's pure parts: acting.js (Track), engine/film.js (defineFilm),
// fx/effects.js (markup generators) and the SSR-safety of the public entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Track, tween, show } from '../src/acting.js';
import { defineFilm, TRANSITION_MS } from '../src/engine/film.js';
import { puff, dust, sparks, pow, flash, rng, FX_DEFS } from '../src/fx/effects.js';
import { Camera } from '../src/kit.js';
import { prospector } from '../src/art/prospector.js';

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
