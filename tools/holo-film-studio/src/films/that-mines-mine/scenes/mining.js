/**
 * Beat 5 - Productive mining montage.
 *   mineIn   : he vanishes into the mine; sparks and ore burst out into the cart.
 *   cutterUp : close-up of the cutter eating rock. Sparks.
 *   cartFull : the cart fills to an absurd height.
 * Beat 6 - Runaway cart.
 *   runaway  : he shoves the overloaded cart, it escapes downhill, he chases and fails.
 */
import { Track, tween } from '../../../acting.js';
import { prospector } from '../../../art/prospector.js';
import { cutter, cart, ore, placed, cartSpot, CART_LOAD_COUNT, CART_TOP } from '../../../art/props.js';
import { dust, sparks, chips, sparkle, mark, pow, drops, puff, speedLines, rays } from '../../../fx/effects.js';
import { Camera, driftClouds, fwd } from '../../../kit.js';
import { frontBack, frontFore, cactus, caveWall, frontTrackY } from '../world.js';

const GY = 604;
const CART_X = 640;
const CART_ROT = -3.4;
const cartPose = (x) => ({ x, y: frontTrackY(x) + 12, rot: CART_ROT });

/** Order the load builds up in: base rows first, the crowning stone last. */
const FILL_ORDER = [...Array(CART_LOAD_COUNT).keys()].filter((i) => i !== CART_TOP).concat(CART_TOP);

function chunkTracks(cues, cartId, loaded = 0) {
  return Array.from({ length: CART_LOAD_COUNT }, (_, i) => {
    const p = cartSpot(i);
    const on = FILL_ORDER.indexOf(i) < loaded;
    return new Track(cues, `${cartId}.ch${i}`, { x: p.x, y: p.y, sx: on ? 1 : 0, sy: on ? 1 : 0 });
  });
}

const pop = (t, at, k = 1.3) => t.keys(at, 300, [{ o: 0.55, sx: k, sy: k, ease: 'ease-out' }, { o: 1, sx: 1, sy: 1 }], { ease: 'linear' });

/** A piece of ore that arcs from a to b and stays there. */
function flyer(ctx, name, { t, dur = 520, from, to, h = 160, variant = 0, size = 1.3, spin = 360 }) {
  const { cues, at } = ctx;
  const id = `${ctx.id}.${name}`;
  const tr = new Track(cues, id, { x: from[0], y: from[1], sx: 0.4, sy: 0.4 });
  tr.keys(at(t), dur, [
    { o: 0.5, x: (from[0] + to[0]) / 2, y: Math.min(from[1], to[1]) - h, rot: spin / 2, sx: size, sy: size, ease: 'cubic-bezier(.2,.7,.4,1)' },
    { o: 1, x: to[0], y: to[1], rot: spin, ease: 'cubic-bezier(.55,0,.9,.55)' },
  ], { ease: 'linear', reduce: 'snap' });
  cues.push({ at: at(t), dur: 1, target: id, keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear' });
  return `<g data-t="${id}" style="opacity:0;${tr.css}">${ore(variant, 1)}</g>`;
}

export function mineIn(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const cartId = `${id}.cart`;
  const cartT = placed(cues, cartId, cart(cartId, { loaded: 0 }), cartPose(CART_X));
  const chunks = chunkTracks(cues, cartId, 0);
  const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: 470, y: GY, scale: 0.92, pack: true, face: 'greed', props: { F: cutter(`${id}.cut`) }, armF: -24 });
  driftClouds(ctx, id);

  // march to the mine and shrink into the dark
  pip.walk(at(0), 950, 842, { stride: 400, amp: 26, bounce: 6, swing: 12 });
  pip.root.to(at(950), 280, { x: 868, sx: 0.5, sy: 0.5 }, { ease: 'ease-in' });
  tween(cues, `${id}.pip`, at(1000), 220, { opacity: 1 }, { opacity: 0 }, { reduce: 'snap' });

  // inside: the cutter screams. Rock and ore are ejected into the cart.
  const flights = [
    { t: 1050, to: [CART_X - 34, 540], variant: 0 },
    { t: 1230, to: [CART_X + 8, 520], variant: 1 },
    { t: 1410, to: [CART_X - 12, 508], variant: 2 },
    { t: 1590, to: [CART_X + 30, 500], variant: 0 },
    { t: 1770, to: [CART_X - 22, 486], variant: 1 },
  ];
  let fl = '';
  flights.forEach((f, i) => {
    fl += flyer(ctx, `fly${i}`, { t: f.t, from: [850, 480], to: f.to, h: 150 + (i % 2) * 40, variant: f.variant, size: 1.25, spin: 540 });
    pop(chunks[FILL_ORDER[i]], at(f.t + 500), 1.35);
  });
  // hide the flyers once their chunk has "landed" in the cart
  flights.forEach((f, i) => cues.push({ at: at(f.t + 500), dur: 1, target: `${id}.fly${i}`, keyframes: [{ opacity: 1 }, { opacity: 0 }], easing: 'linear' }));
  cam.shake(at(1000), 1250, 5, 60);

  const bursts = [0, 1, 2, 3, 4, 5, 6].map(
    (i) => sparks({ x: 856, y: 500 + (i % 2) * 24, at: at(1000 + i * 170), n: 7, power: 120, angle: -Math.PI / 2, spread: Math.PI * 1.8, seed: 40 + i, dur: 520 }) +
      puff({ x: 860, y: 560, at: at(1000 + i * 170), dur: 700, r: 40, dx: -50 - i * 8, dy: -26 })
  ).join('');
  const fx = bursts + mark({ x: 160, y: 96, at: at(0), text: 'MON.', dur: 1200, size: 50 }) + dust({ x: 560, y: GY + 6, at: at(0), n: 3, spread: 30, r: 22, dir: -1, seed: 3 });

  return cam.html(`${frontBack(id)}${cactus(150)}${cartT.html}${fl}${pip.html}${frontFore()}${fx}`);
}

export function cutterUp(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const tool = new Track(cues, `${id}.tool`, { x: 250, y: 470, sx: 3, sy: 3, rot: -4 });
  cam.shake(at(0), ctx.dur, 5, 60);

  const jitter = Array.from({ length: 34 }, (_, i) => ({ o: (i + 1) / 34, x: 250 + (i % 2 ? 4 : -4), y: 470 + (i % 3 ? 2 : -3) }));
  tool.keys(at(0), ctx.dur, jitter, { ease: 'linear', reduce: 'skip' });
  tween(cues, `${id}.cut.disc`, at(0), ctx.dur, { transform: 'rotate(0deg)' }, { transform: 'rotate(-6000deg)' }, { reduce: 'skip' });

  // gems wrenched out of the wall
  let fl = '';
  [0, 1, 2, 3, 4, 5].forEach((i) => {
    fl += flyer(ctx, `gem${i}`, { t: 150 + i * 240, dur: 640, from: [800, 440], to: [980 + i * 40, 740], h: 260 + (i % 3) * 50, variant: i, size: 2.6 + (i % 2), spin: 540 });
  });
  let fx = '';
  for (let i = 0; i < 11; i++) {
    const up = i % 2 === 0;
    fx += sparks({ x: 806, y: 436, at: at(90 + i * 150), n: 7, power: 240, angle: up ? -Math.PI * 0.72 : Math.PI * 0.62, spread: 1.3, seed: 70 + i, size: 1.5, dur: 640 });
    if (i % 2) fx += chips({ x: 806, y: 436, at: at(110 + i * 150), n: 4, power: 200, angle: -Math.PI * 0.8, spread: 1.4, seed: 90 + i, size: 1.7, fill: '#f4f4f4' });
  }
  fx += sparkle({ x: 800, y: 434, at: at(0), dur: 280, n: 8, r: 54 });
  fx += mark({ x: 190, y: 120, at: at(0), text: 'TUES.', dur: 1300, size: 60 });

  const body = `<g data-t="${id}.tool" style="${tool.css}">
    <path d="M-170 70 Q-70 40 -4 6" fill="none" stroke="#0d0d0d" stroke-width="22" stroke-linecap="round"/>
    <path d="M-170 70 Q-70 40 -4 6" fill="none" stroke="#f0f0f0" stroke-width="12" stroke-linecap="round"/>
    ${cutter(`${id}.cut`)}
    <circle cx="0" cy="2" r="16" fill="#fff" stroke="#0d0d0d" stroke-width="5"/></g>`;
  return `${caveWall(id)}${cam.html(`${fl}${body}${fx}`)}`;
}

export function cartFull(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const cartId = `${id}.cart`;
  const cartT = placed(cues, cartId, cart(cartId, { loaded: 6 }), cartPose(CART_X));
  const chunks = chunkTracks(cues, cartId, 6);
  const body = new Track(cues, `${cartId}.body`);
  const whB = new Track(cues, `${cartId}.whB`);
  const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: 880, y: GY, scale: 0.55, flip: -1, pack: true, face: 'plot', props: { F: cutter(`${id}.cut`) }, armF: -24 });
  driftClouds(ctx, id);

  // Pip pops out of the mine, then ore just keeps appearing
  tween(cues, `${id}.pip`, at(0), 200, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
  pip.walk(at(0), 520, 770, { stride: 260, amp: 20, bounce: 5, swing: 10, noRoot: true });
  pip.root.to(at(0), 520, { x: 770, sx: 0.92, sy: 0.92 }, { ease: 'ease-out', reduce: 'snap' });
  const T0 = 380;
  FILL_ORDER.slice(6).forEach((idx, k) => {
    const t = T0 + k * 52;
    pop(chunks[idx], at(t), 1.35);
    body.keys(at(t), 160, [{ o: 0.4, sy: 0.985 - k * 0.002 }, { o: 1, sy: 0.99 - k * 0.003 }], { ease: 'ease-out', reduce: 'skip' });
  });
  const FULL = T0 + (CART_LOAD_COUNT - 6) * 52 + 100;
  // overloaded: the tower sways, springs squash, axle groans
  body.keys(at(FULL), 900, [{ o: 0.2, rot: 3.2 }, { o: 0.4, rot: -3.8 }, { o: 0.6, rot: 2.8 }, { o: 0.8, rot: -2 }, { o: 1, rot: 0.8 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  whB.keys(at(FULL), 900, [{ o: 0.5, sx: 1.12, sy: 0.9 }, { o: 1, sx: 1, sy: 1 }], { ease: 'ease-in-out', reduce: 'skip' });
  pip.face(at(FULL - 100), 'cheer');
  pip.fold(at(FULL + 200));
  pip.face(at(FULL + 600), 'smug');

  const fx =
    mark({ x: 170, y: 96, at: at(0), text: 'WED.', dur: 1300, size: 50 }) +
    FILL_ORDER.slice(6).filter((_, k) => k % 3 === 0).map((idx, k) => {
      const p = cartSpot(idx);
      return sparkle({ x: CART_X + p.x, y: frontTrackY(CART_X) + 12 - 104 + p.y, at: at(T0 + k * 150), dur: 700, r: 22, n: 2 });
    }).join('') +
    sparkle({ x: CART_X + 30, y: frontTrackY(CART_X) + 12 - 104 - 318, at: at(FULL), dur: 800, r: 34, n: 2 }) +
    drops({ x: 800, y: 440, at: at(FULL + 700), n: 2, seed: 4 });

  return cam.html(`${frontBack(id)}${cactus(150)}${cartT.html}${pip.html}${frontFore()}${fx}`);
}

export function runaway(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const cartId = `${id}.cart`;
  const cartT = placed(cues, cartId, cart(cartId, { loaded: CART_LOAD_COUNT }), cartPose(CART_X));
  const body = new Track(cues, `${cartId}.body`);
  const whB = new Track(cues, `${cartId}.whB`);
  const whF = new Track(cues, `${cartId}.whF`);
  const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: 800, y: GY, scale: 0.92, pack: true, face: 'plot', flip: -1, props: { F: cutter(`${id}.cut`) }, armF: -80, armB: -80 });
  driftClouds(ctx, id);

  // --- push, push, push (it doesn't budge)
  pip.root.to(at(0), 500, { rot: fwd(pip, 18) }, { ease: 'ease-out' });
  pip.face(at(0), 'angry');
  pip.walk(at(500), 800, 800, { stride: 190, amp: 34, bounce: 3, swing: 0 });
  body.keys(at(500), 800, Array.from({ length: 8 }, (_, i) => ({ o: (i + 1) / 8, rot: i % 2 ? -2 : 2.4 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  cartT.track.to(at(900), 400, { x: CART_X - 14, y: cartPose(CART_X - 14).y }, { ease: 'ease-in-out', reduce: 'snap' });

  // --- it gives... and it GOES. Pip is dragged along, then faceplants.
  const GO = 1300;
  const GODUR = 2100;
  const x1 = -300;
  cartT.track.to(at(GO), GODUR, { x: x1, y: frontTrackY(x1) + 12 }, { ease: 'cubic-bezier(.55,.05,1,.7)', reduce: 'snap' });
  const spin = -((CART_X - 14 - x1) / 26) * (180 / Math.PI);
  whF.to(at(GO), GODUR, { rot: spin }, { ease: 'cubic-bezier(.55,.05,1,.7)', reduce: 'skip' });
  whB.to(at(GO), GODUR, { rot: spin }, { ease: 'cubic-bezier(.55,.05,1,.7)', reduce: 'skip' });
  body.keys(at(GO + 300), GODUR - 300, Array.from({ length: 9 }, (_, i) => ({ o: (i + 1) / 9, rot: i % 2 ? -4.5 : 5 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  pip.face(at(GO), 'shock');
  pip.walk(at(GO), 420, 668, { stride: 140, amp: 44, bounce: 4, swing: 0, ease: 'ease-in' });
  pip.root.keys(at(GO + 420), 380, [
    { o: 0.5, x: 640, y: GY - 36, rot: fwd(pip, 55), ease: 'cubic-bezier(.2,.7,.4,1)' },
    { o: 1, x: 598, y: 562, rot: fwd(pip, 88), ease: 'cubic-bezier(.6,0,.9,.5)' },
  ], { ease: 'linear', reduce: 'snap' });
  pip.armF.to(at(GO + 420), 200, { rot: -150 });
  pip.armB.to(at(GO + 420), 200, { rot: -150 });
  const FLOP = GO + 800;
  cam.shake(at(FLOP), 300, 8);
  pip.face(at(FLOP), 'normal');
  pip.head.to(at(FLOP + 200), 300, { rot: -30 }, { ease: 'ease-out' });

  // --- he looks up: the cart is a dot
  pip.face(at(2450), 'shock');
  pip.head.to(at(2450), 150, { rot: -46 });
  // --- and he's off
  const CHASE = 2950;
  pip.root.keys(at(2750), 360, [
    { o: 0.5, y: GY - 12, rot: fwd(pip, 26), ease: 'ease-out' },
    { o: 1, y: GY, rot: fwd(pip, 18), ease: 'cubic-bezier(.4,0,.5,1.4)' },
  ], { ease: 'linear', reduce: 'snap' });
  pip.head.to(at(2750), 200, { rot: 0 });
  pip.armF.to(at(2750), 160, { rot: -60 });
  pip.armB.to(at(2750), 160, { rot: -60 });
  pip.face(at(2900), 'angry');
  pip.walk(at(CHASE), 1500, -240, { stride: 150, amp: 54, bounce: 8, swing: 40 });

  // --- ore shed along the way, pebbles that stay behind
  let litter = '';
  const shed = [
    { t: GO + 700, from: [470, 520], to: [560, 640], v: 0 },
    { t: GO + 950, from: [300, 520], to: [420, 650], v: 1 },
    { t: GO + 1200, from: [120, 530], to: [250, 660], v: 2 },
    { t: GO + 1450, from: [-20, 540], to: [90, 668], v: 0 },
  ];
  shed.forEach((s, i) => {
    litter += flyer(ctx, `shed${i}`, { t: s.t, dur: 560, from: s.from, to: s.to, h: 140, variant: s.v, size: 1.1, spin: 300 });
  });

  const trail = [0, 1, 2, 3, 4, 5].map((i) => dust({ x: 580 - i * 150, y: frontTrackY(580 - i * 150) + 14, at: at(GO + 480 + i * 210), n: 3, spread: 36, r: 30, dir: 1, seed: 100 + i, dur: 900 })).join('');
  const fx =
    drops({ x: 770, y: 440, at: at(450), n: 3, seed: 2 }) +
    dust({ x: 760, y: GY + 8, at: at(500), n: 4, spread: 30, r: 22, dir: 1, seed: 7 }) +
    pow({ x: 640, y: 300, at: at(900), text: 'CREEAK!', scale: 0.62, rot: -6, font: 56, dur: 800 }) +
    dust({ x: 598, y: GY + 6, at: at(FLOP), n: 6, spread: 70, r: 32, dir: 1, seed: 12, dur: 1000 }) +
    pow({ x: 640, y: 480, at: at(FLOP + 20), text: 'FLOP!', scale: 0.5, rot: 6, font: 56, dur: 700 }) +
    mark({ x: 600, y: 360, at: at(2450), dur: 900, size: 90 }) +
    trail +
    dust({ x: 640, y: GY + 8, at: at(CHASE), n: 5, spread: 40, r: 24, dir: 1, seed: 15, dur: 800 }) +
    [0, 1, 2, 3].map((i) => dust({ x: 560 - i * 260, y: GY + 8, at: at(CHASE + 250 + i * 330), n: 3, spread: 30, r: 24, dir: 1, seed: 120 + i, dur: 700 })).join('');

  return cam.html(`${frontBack(id)}${cactus(150)}${litter}${cartT.html}${pip.html}${frontFore()}${fx}`);
}
