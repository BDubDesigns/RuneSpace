/**
 * Beats 7 + 8 - The lucky rival, and the final visual punchline.
 *   wake   : behind the mountain. The rival wakes; the runaway cart crashes; he surfaces on a mountain of ore and plants a sign.
 *   proud  : the first prospector trudges back, then stands proudly by his (empty) mine.
 *   finale : the rival on his ore pile, MINE! sign beside him. Iris out.
 */
import { Track, tween } from '../../../acting.js';
import { prospector } from '../../../art/prospector.js';
import { cart, orePile, boulder, sign, ore, placed, cutter, cartSpot, CART_LOAD_COUNT } from '../../../art/props.js';
import { dust, sparks, chips, sparkle, mark, pow, rays, dizzy, zzz, flash, speedLines, puff, drops } from '../../../fx/effects.js';
import { Camera, driftClouds, idle, fwd, popIn } from '../kit.js';
import { frontBack, frontFore, cactus, backWorld, BACK_GROUND_Y, backTrackY, BACK_SLOPE_DEG } from '../world.js';
import { TEXT } from '../config.js';

const GY = 604;
const BGY = BACK_GROUND_Y;
const PILE = { x: 210, y: BGY + 6, s: 1.0 };
const PILE_TOP = PILE.y - 208 * PILE.s + 6;
const BOULDER_X = 470;
const CRASH_X = 650;
const CART_SLOPE = -BACK_SLOPE_DEG;
const cartOnSlope = (x) => ({ x, y: backTrackY(x) + 4, rot: CART_SLOPE });

/** A tumbleweed: scribbled ring that bounces across the foreground. */
function tumbleweed(ctx, name, { t, dur, from, to, y }) {
  const { cues, at } = ctx;
  const id = `${ctx.id}.${name}`;
  cues.push({ at: at(t), dur, target: id, keyframes: [{ transform: `translate(${from}px, ${y}px)` }, { transform: `translate(${to}px, ${y}px)` }], easing: 'linear', reduce: 'snap' });
  const hop = new Track(cues, `${id}.hop`);
  hop.keys(at(t), dur, [
    { o: 0.2, y: -26, ease: 'ease-out' }, { o: 0.4, y: 0, ease: 'ease-in' },
    { o: 0.6, y: -18, ease: 'ease-out' }, { o: 0.8, y: 0, ease: 'ease-in' }, { o: 1, y: -10, ease: 'ease-out' },
  ], { ease: 'linear', reduce: 'skip' });
  tween(cues, `${id}.spin`, at(t), dur, { transform: 'rotate(0deg)' }, { transform: `rotate(${(from - to) * -1.6}deg)` }, { reduce: 'skip' });
  const ring = [0, 1, 2, 3, 4, 5]
    .map((i) => `<path d="M-26 ${i * 4 - 10} Q0 ${i * 9 - 34} 26 ${i * 4 - 10} Q0 ${i * 9 + 14} -26 ${i * 4 - 10}Z" fill="none" stroke="#2b2b2b" stroke-width="2.6"/>`)
    .join('');
  return `<g data-t="${id}" style="transform:translate(${from}px, ${y}px)"><g data-t="${id}.hop"><g data-t="${id}.spin"><circle r="30" fill="none" stroke="#3a3a3a" stroke-width="3" stroke-dasharray="9 4"/>${ring}</g></g></g>`;
}

export function wake(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const rex = prospector(cues, `${id}.rex`, { kind: 'rex', x: 130, y: BGY - 30, scale: 0.88, flip: -1, rot: 90, face: 'ko', hatY: -1500 });
  const cartId = `${id}.cart`;
  const cartT = placed(cues, cartId, cart(cartId, { loaded: CART_LOAD_COUNT }), { ...cartOnSlope(1400) });
  const whB = new Track(cues, `${cartId}.whB`);
  const whF = new Track(cues, `${cartId}.whF`);
  const cartBody = new Track(cues, `${cartId}.body`);
  const chunkT = Array.from({ length: CART_LOAD_COUNT }, (_, i) => {
    const p = cartSpot(i);
    return new Track(cues, `${cartId}.ch${i}`, { x: p.x, y: p.y, sx: 1, sy: 1 });
  });
  const pile = placed(cues, `${id}.pile`, orePile(5), { x: PILE.x, y: PILE.y, sx: 0, sy: 0 });
  const flag = placed(cues, `${id}.sign`, sign('rex', TEXT.sign), { x: PILE.x + 70, y: PILE_TOP - 150, sx: 0, sy: 0 });
  driftClouds(ctx, id);

  // --- out cold, stars circling; then a snore
  rex.face(at(1000), 'sleep');
  rex.torso.keys(at(1000), 1900, [0, 1, 2, 3].flatMap((i) => [{ o: (i * 2 + 1) / 8, sy: 1.035 }, { o: (i * 2 + 2) / 8, sy: 1 }]), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  // --- wakes up: eyes open, sits bolt upright with a boing
  rex.face(at(3000), 'normal');
  rex.head.to(at(3200), 300, { rot: fwd(rex, -28) }, { ease: 'ease-out' });
  rex.face(at(3350), 'shock');
  rex.root.keys(at(3550), 640, [
    { o: 0.55, rot: -8, y: BGY, ease: 'cubic-bezier(.3,.6,.4,1)' },
    { o: 1, rot: 0, y: BGY, ease: 'cubic-bezier(.4,0,.5,1.3)' },
  ], { ease: 'linear', reduce: 'snap' });
  rex.head.to(at(3550), 400, { rot: 0 });
  rex.face(at(4200), 'sad'); // rubs the lump on his head
  rex.armF.to(at(4200), 220, { rot: -154 }, { ease: 'ease-out' });
  rex.armF.keys(at(4420), 320, [{ o: 0.33, rot: -142 }, { o: 0.66, rot: -158 }, { o: 1, rot: -150 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  // --- rumble. turns around.
  cam.shake(at(4500), 900, 3, 70);
  rex.face(at(4800), 'shock');
  rex.root.to(at(4780), 200, { flip: 1 }, { ease: 'ease-in-out' });
  rex.armF.to(at(4800), 160, { rot: 0 });
  rex.head.to(at(4900), 240, { rot: fwd(rex, -14) });

  // --- the cart: down the back slope, accelerating
  const CART_IN = 5100;
  const HIT = 6400; // a longer, scarier approach so the crash has time to land
  cartT.track.to(at(CART_IN), HIT - CART_IN, cartOnSlope(CRASH_X), { ease: 'cubic-bezier(.5,0,.9,.9)', reduce: 'snap' });
  const spin = -((1400 - CRASH_X) / 26) * (180 / Math.PI);
  whF.to(at(CART_IN), HIT - CART_IN, { rot: spin }, { ease: 'cubic-bezier(.5,0,.9,.9)', reduce: 'skip' });
  whB.to(at(CART_IN), HIT - CART_IN, { rot: spin }, { ease: 'cubic-bezier(.5,0,.9,.9)', reduce: 'skip' });
  cartBody.keys(at(CART_IN), HIT - CART_IN, Array.from({ length: 8 }, (_, i) => ({ o: (i + 1) / 8, rot: i % 2 ? -3 : 3 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  // Rex braces: arms over head, shrinks into a squat
  rex.armF.to(at(5900), 200, { rot: -170 });
  rex.armB.to(at(5900), 200, { rot: 170 });
  rex.bob.to(at(6000), 300, { sy: 0.86, sx: 1.06 }, { ease: 'ease-out' });
  rex.face(at(6000), 'sad');

  // --- CRASH: cart stops dead, flips over the boulder, ore everywhere
  cartT.track.keys(at(HIT), 1100, [
    { o: 0.45, x: 420, y: 200, rot: -300, ease: 'cubic-bezier(.2,.7,.4,1)' },
    { o: 1, x: 40, y: 470, rot: -560, ease: 'cubic-bezier(.55,0,.9,.5)' },
  ], { ease: 'linear', reduce: 'snap' });
  whF.to(at(HIT), 1100, { rot: spin - 900 }, { ease: 'ease-out', reduce: 'skip' });
  whB.to(at(HIT), 1100, { rot: spin - 700 }, { ease: 'ease-out', reduce: 'skip' });
  chunkT.forEach((t) => t.set(at(HIT + 10), { sx: 0, sy: 0 }));
  cam.shake(at(HIT), 800, 20, 55);

  let spray = '';
  for (let i = 0; i < 13; i++) {
    const tx = PILE.x - 170 + ((i * 281) % 340);
    const ty = BGY - 10 - ((i * 37) % 30);
    const f = new Track(cues, `${id}.o${i}`, { x: 600, y: 470, sx: 0.5, sy: 0.5 });
    f.keys(at(HIT + 40 + i * 25), 1150, [
      { o: 0.5, x: (600 + tx) / 2, y: 120 + (i % 4) * 40, rot: 360, sx: 1.7, sy: 1.7, ease: 'cubic-bezier(.2,.7,.4,1)' },
      { o: 1, x: tx, y: ty, rot: 720, sx: 1.3, sy: 1.3, ease: 'cubic-bezier(.55,0,.9,.5)' },
    ], { ease: 'linear', reduce: 'snap' });
    cues.push({ at: at(HIT + 40 + i * 25), dur: 1, target: `${id}.o${i}`, keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear' });
    spray += `<g data-t="${id}.o${i}" style="opacity:0;${f.css}">${ore(i, 1)}</g>`;
  }
  const ERUPT = HIT + 420;
  pile.track.keys(at(ERUPT), 800, [
    { o: 0.55, sx: PILE.s * 0.95, sy: PILE.s * 1.22, ease: 'cubic-bezier(.2,.8,.4,1)' },
    { o: 1, sx: PILE.s, sy: PILE.s, ease: 'cubic-bezier(.4,0,.5,1.2)' },
  ], { ease: 'linear', reduce: 'snap' });
  // buried
  cues.push({ at: at(ERUPT + 200), dur: 1, target: `${id}.rex`, keyframes: [{ opacity: 1 }, { opacity: 0 }], easing: 'linear' });

  // --- he surfaces on top of his new mountain
  const POP = HIT + 1650; // dust clears, then he surfaces
  const FLAG = POP + 450;
  cues.push({ at: at(POP), dur: 1, target: `${id}.rex`, keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear' });
  rex.root.set(at(POP - 1), { x: PILE.x - 10, y: PILE_TOP + 6, flip: 1, sx: 0.1, sy: 0.1, rot: 0 });
  rex.root.keys(at(POP), 420, [{ o: 0.6, sx: 1.0, sy: 1.0, ease: 'ease-out' }, { o: 1, sx: 0.88, sy: 0.88, ease: 'ease-in-out' }], { ease: 'linear', reduce: 'snap' });
  rex.bob.set(at(POP - 1), { sx: 1, sy: 1 });
  rex.face(at(POP), 'greed');
  rex.armF.to(at(POP + 100), 200, { rot: -150 });
  rex.armB.to(at(POP + 100), 200, { rot: 150 });
  rex.face(at(POP + 600), 'cheer');
  rex.bob.hop(at(POP + 600), 300, 18);
  rex.bob.hop(at(POP + 900), 300, 18);

  // --- MINE!
  popIn(flag, at(FLAG), PILE.x + 78, PILE_TOP - 90);
  flag.track.keys(at(FLAG + 330), 260, [{ o: 1, y: PILE_TOP + 8 }], { ease: 'cubic-bezier(.6,0,1,.6)' });
  flag.track.keys(at(FLAG + 620), 520, [{ o: 0.25, rot: 8 }, { o: 0.5, rot: -5 }, { o: 0.75, rot: 3 }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  // the camera drifts in on the new king of the mountain and holds
  cam.look(at(POP + 300), 3300, { x: PILE.x + 120, y: 400, s: 1.2 }, 'ease-in-out');

  const fx =
    dizzy({ x: 344, y: BGY - 56, at: at(0), dur: 1100, rx: 54, ry: 13 }) +
    zzz({ x: 372, y: BGY - 120, at: at(1000), dur: 2000 }) +
    [0, 1, 2].map((i) => chips({ x: 300 + i * 90, y: BGY - 4, at: at(4600 + i * 220), n: 3, power: 40, angle: -Math.PI / 2, spread: 1.8, seed: 7 + i, size: 0.7, fill: '#555' })).join('') +
    mark({ x: 190, y: BGY - 330, at: at(4800), text: '?', dur: 900, size: 90 }) +
    // impact
    flash({ at: at(HIT), dur: 220, peak: 0.95 }) +
    pow({ x: 560, y: 215, at: at(HIT + 10), text: 'CRASH!', scale: 0.95, rot: -8, dur: 1200 }) +
    rays({ x: CRASH_X - 90, y: 480, at: at(HIT), r0: 40, r1: 130, n: 14, dur: 420 }) +
    sparks({ x: CRASH_X - 100, y: 500, at: at(HIT), n: 14, power: 200, angle: -Math.PI * 0.75, spread: 1.6, seed: 3 }) +
    chips({ x: CRASH_X - 100, y: 500, at: at(HIT), n: 8, power: 180, angle: -Math.PI * 0.75, spread: 1.7, seed: 9, fill: '#f4f4f4' }) +
    dust({ x: BOULDER_X + 20, y: BGY, at: at(HIT), n: 7, spread: 160, r: 52, dir: -1, seed: 50, dur: 1300 }) +
    dust({ x: PILE.x, y: BGY, at: at(ERUPT), n: 9, spread: 220, r: 66, dir: 0, seed: 51, dur: 1500 }) +
    dust({ x: PILE.x + 60, y: BGY - 40, at: at(ERUPT + 120), n: 6, spread: 160, r: 58, dir: 0, seed: 52, dur: 1400 }) +
    dust({ x: 40, y: 560, at: at(HIT + 1100), n: 5, spread: 80, r: 44, dir: -1, seed: 53, dur: 1100 }) +
    sparkle({ x: PILE.x - 30, y: PILE_TOP + 40, at: at(POP + 100), dur: 700, r: 34, n: 3 }) +
    sparkle({ x: PILE.x + 90, y: PILE_TOP + 90, at: at(POP + 350), dur: 700, r: 26, n: 3 }) +
    sparkle({ x: PILE.x - 110, y: PILE_TOP + 130, at: at(POP + 600), dur: 700, r: 28, n: 2 }) +
    sparks({ x: PILE.x + 78, y: PILE_TOP - 70, at: at(FLAG), n: 9, power: 80, angle: 0, spread: Math.PI * 2, seed: 4, size: 0.9 }) +
    dust({ x: PILE.x + 80, y: PILE_TOP + 10, at: at(FLAG + 330 + 260), n: 3, spread: 30, r: 16, seed: 18, dur: 600 }) +
    pow({ x: PILE.x + 190, y: PILE_TOP - 110, at: at(FLAG + 640), text: 'THUNK', scale: 0.4, rot: 6, font: 58, dur: 500 });

  const backdrop = `${backWorld(id)}<g transform="translate(${BOULDER_X} ${BGY + 4})">${boulder(170, 130)}</g>`;
  return cam.html(`${backdrop}${spray}${cartT.html}${rex.html}${pile.html}${flag.html}${fx}`);
}

export function proud(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: -170, y: GY, scale: 0.92, pack: true, face: 'sad', props: { F: cutter(`${id}.cut`) }, armF: 14 });
  const s1 = placed(cues, `${id}.p2`, sign('pip', TEXT.sign), { x: 630, y: 606, rot: 2 });
  const s2 = placed(cues, `${id}.r2`, sign('rex', TEXT.sign), { x: 692, y: 606, rot: -2 });
  driftClouds(ctx, id);

  // --- trudges back, dragging the cutter, hat sagging
  pip.head.set(at(0), { rot: 9 });
  pip.walk(at(0), 1700, 430, { stride: 760, amp: 18, bounce: 4, swing: 8 });
  // --- looks up: the claim signs are still standing
  pip.head.to(at(1750), 240, { rot: fwd(pip, -4) }, { ease: 'ease-out' });
  pip.face(at(1800), 'normal');
  pip.face(at(2050), 'smug');
  pip.bob.keys(at(2050), 420, [{ o: 0.5, sy: 1.05, sx: 1.08 }, { o: 1, sy: 1, sx: 1 }], { ease: 'ease-out', reduce: 'skip' }); // chest out
  pip.armF.to(at(2050), 200, { rot: -28 });
  // --- tidies up: yanks the other fellow's sign and tosses it away
  pip.walk(at(2300), 250, 560, { stride: 250, amp: 18, bounce: 3, swing: 4 });
  pip.armB.to(at(2550), 140, { rot: -80 }, { ease: 'ease-out' });
  s2.track.keys(at(2650), 200, [{ o: 1, y: 470, rot: 14 }], { ease: 'ease-out' });
  pip.armB.to(at(2830), 120, { rot: -160 }, { ease: 'ease-out' });
  s2.track.keys(at(2860), 800, [
    { o: 0.45, x: 1000, y: 170, rot: 330, ease: 'cubic-bezier(.2,.7,.4,1)' },
    { o: 1, x: 1400, y: 560, rot: 700, ease: 'cubic-bezier(.5,0,.9,.6)' },
  ], { ease: 'linear', reduce: 'snap' });
  pip.armB.to(at(3050), 200, { rot: 0 });
  // --- hands on hips, proud as can be
  pip.fold(at(3150));
  pip.face(at(3150), 'cheer');
  pip.bob.keys(at(3150), 800, [{ o: 0.3, sy: 1.03 }, { o: 0.6, sy: 1 }, { o: 1, sy: 1.02 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  const fx =
    tumbleweedFor(ctx) +
    dust({ x: 560, y: GY + 6, at: at(2300), n: 3, spread: 24, r: 18, dir: 1, seed: 5 }) +
    sparkle({ x: 468, y: 392, at: at(3250), dur: 700, r: 20, n: 2 }) +
    sparkle({ x: 620, y: 470, at: at(3350), dur: 700, r: 26, n: 2 });
  return cam.html(`${frontBack(id)}${cactus(150)}${s1.html}${s2.html}${pip.html}${frontFore()}${fx}`);
}

function tumbleweedFor(ctx) {
  return tumbleweed(ctx, 'tw', { t: 200, dur: 3800, from: 1380, to: -140, y: GY + 70 });
}

export function finale(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 250, y: 350, s: 1.28 });
  cam.look(at(0), ctx.dur, { x: 246, y: 344, s: 1.4 }, 'linear');
  const rex = prospector(cues, `${id}.rex`, { kind: 'rex', x: PILE.x - 10, y: PILE_TOP + 6, scale: 0.88, face: 'cheer', hatY: -1500, armF: -150, armB: 150 });
  const cartId = `${id}.cart`;
  const wreck = placed(cues, cartId, cart(cartId, { loaded: 0 }), { x: 30, y: 474, rot: -560 });
  const whF = new Track(cues, `${cartId}.whF`);
  const whB = new Track(cues, `${cartId}.whB`);
  const pile = placed(cues, `${id}.pile`, orePile(5), { x: PILE.x, y: PILE.y, sx: PILE.s, sy: PILE.s });
  const flag = placed(cues, `${id}.sign`, sign('rex', TEXT.sign), { x: PILE.x + 78, y: PILE_TOP + 8 });
  driftClouds(ctx, id);

  whF.to(at(0), 2600, { rot: -420 }, { ease: 'ease-out', reduce: 'skip' });
  whB.to(at(0), 2600, { rot: -300 }, { ease: 'ease-out', reduce: 'skip' });
  idle(rex, 0, 3400, 900);
  rex.root.keys(at(300), 900, [{ o: 0.5, rot: fwd(rex, -3) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  // --- the hat from the bonk finally comes home. He doesn't notice.
  const PLOP = 1200;
  rex.hat.keys(at(PLOP), 520, [{ o: 1, y: 0, ease: 'cubic-bezier(.5,0,.9,.6)' }], { ease: 'linear', reduce: 'snap' });
  rex.hat.keys(at(PLOP + 520), 280, [{ o: 0.3, y: -22, ease: 'ease-out' }, { o: 1, y: 0, ease: 'ease-in' }], { ease: 'linear', reduce: 'skip' });
  rex.head.keys(at(PLOP + 520), 260, [{ o: 0.4, sy: 0.9, sx: 1.04 }, { o: 1, sy: 1, sx: 1 }], { ease: 'ease-out', reduce: 'skip' });

  // --- tap-tap on the sign for luck
  flag.track.keys(at(2100), 600, [{ o: 0.25, rot: 6 }, { o: 0.5, rot: -4 }, { o: 0.75, rot: 2 }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  rex.armB.to(at(1900), 200, { rot: 160 });
  rex.armF.keys(at(2200), 700, [{ o: 0.25, rot: -135 }, { o: 0.5, rot: -160 }, { o: 0.75, rot: -135 }, { o: 1, rot: -150 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  const sparkles = [[-60, 150], [90, 100], [-170, 60], [160, 20], [30, 210], [-110, 200]].map(([dx, dy], i) =>
    sparkle({ x: PILE.x + dx, y: PILE_TOP + dy, at: at(i * 230), dur: 1000, r: 22 + (i % 3) * 8, n: 4 })
  ).join('');
  const fx =
    sparkles +
    pow({ x: PILE.x + 120, y: PILE_TOP - 250, at: at(PLOP + 520), text: 'PLOP', scale: 0.45, rot: 8, font: 58, dur: 700 }) +
    puff({ x: 30, y: 420, at: at(0), dur: 1400, r: 30, dy: -90, dx: 20 }) + puff({ x: 40, y: 430, at: at(700), dur: 1400, r: 26, dy: -90, dx: -10 }) +
    sparks({ x: PILE.x, y: PILE_TOP + 80, at: at(2300), n: 6, power: 60, angle: -Math.PI / 2, spread: 2, seed: 5, size: 0.8 });

  return cam.html(`${backWorld(id)}<g transform="translate(${BOULDER_X} ${BGY + 4})">${boulder(170, 130)}</g>${wreck.html}${pile.html}${rex.html}${flag.html}${fx}`);
}
