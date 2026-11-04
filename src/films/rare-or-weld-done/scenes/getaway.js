/**
 * Beat 3 - The impossible getaway (cut-away view of the gallery: Emerald in the middle, the hole at the right).
 *   sack    : a tiny sack. He pushes. He shoulders it. He tries a rope. Nothing.
 *   kickRun : he backs up. And up. And up.
 *   kick    : the run, the JUMP-KICK, BOOOONG, the rebound, the heap with stars.
 */
import { prospector } from '../../../art/prospector.js';
import { swagSack, connectHose } from '../../../art/weld.js';
import { emerald } from '../../../art/emerald.js';
import { placed, INK } from '../../../art/props.js';
import { dust, puff, mark, pow, rays, drops, flash, sparkle, rings, dizzy, speedLines, chips } from '../../../fx/effects.js';
import { Camera, fwd } from '../../../kit.js';
import { show, tween } from '../../../acting.js';
import { sectionBack, sectionFront, GY } from '../world.js';

const SC = 0.95;
export const EMX = 700; // Emerald centre x in the cut-away
export const EMS = 1.4; // Emerald scale (420 x 504 px)
export const EM_BASE = GY - 10;
const LEFT = EMX - 210;
const RIGHT = EMX + 210;

/** The Emerald standing on its mat. */
export function gemOnMat(cues, id, extra = {}) {
  const g = placed(cues, `${id}.gem`, `<g transform="scale(${EMS})">${emerald(`${id}.em`, { w: 300, h: 360 })}</g>`, { x: EMX, y: EM_BASE, ...extra });
  const mat = `<ellipse cx="${EMX}" cy="${GY - 4}" rx="290" ry="18" fill="#3c3c3c" stroke="${INK}" stroke-width="5"/><ellipse cx="${EMX}" cy="${GY - 8}" rx="250" ry="11" fill="#6a6a6a"/>`;
  return { gem: g, mat };
}

/** A fresh take of the gallery for one failed attempt: the Emerald on its mat, the thief, and a camera. */
function attempt(ctx, thiefOpts, cam0) {
  const { cues, id } = ctx;
  const cam = new Camera(cues, id, cam0);
  const { gem, mat } = gemOnMat(cues, id);
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', scale: SC, y: GY, goggles: 'up', ...thiefOpts });
  return { cam, gem, mat, thief };
}
const shudder = (cues, at, gem, t, n, px) => gem.track.keys(at(t), n * 110, Array.from({ length: n }, (_, i) => ({ o: (i + 1) / n, x: EMX + (i % 2 ? px : -px) })).concat([{ o: 1, x: EMX }]), { ease: 'linear', reduce: 'skip' });

/* ------------------------------------------------------------------ attempt 1: the sack */

export function sack(ctx) {
  const { cues, at, id } = ctx;
  const { cam, gem, mat, thief } = attempt(ctx, { x: 200, face: 'normal', props: { F: swagSack() }, armF: -60 }, { x: 520, y: 430, s: 1.25 });
  // he walks up and holds the bank bag against the gem: its edge touches the gem's face (x = 490)
  thief.walk(at(100), 800, 356, { stride: 330, amp: 16, bounce: 5, swing: 0 });
  thief.armF.to(at(1000), 380, { rot: -108 }, { ease: 'ease-out' });
  thief.face(at(1000), 'smug');
  // he really tries to stuff it in: the bag stretches to half again, then to double its size... and still is nowhere near
  const stretch = (t, dur, k, ease = 'ease-in-out') => thief.propF.to(at(t), dur, { sx: k, sy: k }, { ease, reduce: 'snap' });
  thief.face(at(1500), 'angry');
  stretch(1500, 800, 1.5);
  thief.propF.keys(at(2300), 500, Array.from({ length: 6 }, (_, i) => ({ o: (i + 1) / 6, sx: 1.5 + (i % 2 ? 0.05 : -0.04), sy: 1.5 + (i % 2 ? -0.04 : 0.05) })).concat([{ o: 1, sx: 1.5, sy: 1.5 }]), { ease: 'linear', reduce: 'skip' });
  thief.head.keys(at(2300), 500, [{ o: 0.5, rot: fwd(thief, 6) }, { o: 1, rot: fwd(thief, 0) }], { ease: 'ease-in-out', reduce: 'skip' });
  stretch(2800, 900, 2.0);
  thief.propF.keys(at(3700), 600, Array.from({ length: 8 }, (_, i) => ({ o: (i + 1) / 8, sx: 2 + (i % 2 ? 0.07 : -0.05), sy: 2 + (i % 2 ? -0.05 : 0.07) })).concat([{ o: 1, sx: 2, sy: 2 }]), { ease: 'linear', reduce: 'skip' });
  thief.vibrate(at(2800), 1500, 2.6);
  // it gives up: the bag snaps back with a boing and he is left holding a tiny bag
  thief.propF.keys(at(4400), 520, [{ o: 0.3, sx: 0.78, sy: 0.78 }, { o: 0.6, sx: 1.1, sy: 1.1 }, { o: 1, sx: 1, sy: 1 }], { seg: 'ease-out', ease: 'linear', reduce: 'snap' });
  thief.face(at(4400), 'shock');
  thief.head.to(at(4400), 200, { rot: fwd(thief, -6) });
  thief.armF.to(at(4500), 260, { rot: -70 }, { ease: 'ease-out' });
  thief.face(at(5000), 'sad');
  thief.head.to(at(5000), 300, { rot: fwd(thief, 10) });
  thief.armF.to(at(5300), 340, { rot: -30 }, { ease: 'ease-in-out' });
  show(cues, `${id}.thief.propF`, at(5900), false);
  const fx =
    sparkle({ x: 760, y: 190, at: at(300), dur: 1000, r: 34, n: 3, s: 1.3 }) +
    drops({ x: 400, y: 380, at: at(3000), n: 4, seed: 12, spread: 70 }) +
    pow({ x: 380, y: 300, at: at(4420), text: 'BOING!', scale: 0.55, rot: -8, font: 58, dur: 800 }) +
    mark({ x: 420, y: 330, at: at(5000), text: '?', dur: 1000, size: 84 });
  return cam.html(`${sectionBack(id)}${mat}${gem.html}${thief.html}${sectionFront()}${fx}`);
}

/* ------------------------------------------------------------------ attempt 2: push */

export function push(ctx) {
  const { cues, at, id } = ctx;
  const { cam, gem, mat, thief } = attempt(ctx, { x: 250, face: 'normal', armF: -20 }, { x: 540, y: 440, s: 1.35 });
  const FACE = LEFT; // the gem's flat left face
  // walks up, both palms flat on the gem's face (hand = root.x + 89 with the arm raised 10 degrees)
  thief.walk(at(100), 800, FACE + 10 - 89, { stride: 300, amp: 22, bounce: 4, swing: 0 });
  thief.face(at(900), 'angry');
  thief.armF.to(at(900), 300, { rot: -100 }, { ease: 'ease-out' });
  thief.armB.to(at(900), 300, { rot: -96 }, { ease: 'ease-out' });
  // leans in: the root pivots at the feet, so slide it back by the amount the hands move to keep them on the stone
  const x0 = FACE + 10 - 89;
  thief.root.to(at(1300), 450, { rot: fwd(thief, 12), x: x0 - 27 }, { ease: 'ease-out', reduce: 'snap' });
  thief.legF.keys(at(1800), 1100, Array.from({ length: 6 }, (_, i) => ({ o: (i + 1) / 6, rot: i % 2 ? 24 : -8 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  thief.legB.keys(at(1800), 1100, Array.from({ length: 6 }, (_, i) => ({ o: (i + 1) / 6, rot: i % 2 ? -8 : 24 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  thief.vibrate(at(1800), 1100, 3.2);
  shudder(cues, at, gem, 1800, 8, 1.5);
  // gives up: slumps off the stone
  thief.face(at(3000), 'sad');
  thief.legF.to(at(3000), 240, { rot: 0 });
  thief.legB.to(at(3000), 240, { rot: 0 });
  thief.root.to(at(3000), 500, { rot: 0, x: x0 - 60 }, { ease: 'ease-in-out', reduce: 'snap' });
  thief.armF.to(at(3000), 400, { rot: -10 });
  thief.armB.to(at(3000), 400, { rot: 0 });
  thief.head.to(at(3000), 400, { rot: fwd(thief, 14) });
  const fx =
    dust({ x: x0 - 10, y: GY + 4, at: at(1700), n: 5, spread: 40, r: 18, dir: -1, seed: 7, dur: 900 }) +
    drops({ x: x0 + 40, y: 400, at: at(2400), n: 3, seed: 8, spread: 70 }) +
    pow({ x: 400, y: 330, at: at(1750), text: 'HNNG!', scale: 0.5, rot: -8, font: 58, dur: 900 });
  return cam.html(`${sectionBack(id)}${mat}${gem.html}${thief.html}${sectionFront()}${fx}`);
}

/* ------------------------------------------------------------------ attempt 3: the shoulder */

export function shoulder(ctx) {
  const { cues, at, id } = ctx;
  const { cam, gem, mat, thief } = attempt(ctx, { x: 190, face: 'plot', armF: -10 }, { x: 460, y: 450, s: 1.2 });
  const HITX = LEFT - 114; // leaning 30 degrees, the leading shoulder is 114 px ahead of the feet: it meets the face at x = 490
  // backs off, crouches, charges, SLAM
  thief.walk(at(300), 600, 120, { stride: 260, amp: 20, bounce: 3, swing: 0 });
  thief.bob.keys(at(1000), 500, [{ o: 0.5, sy: 0.84, sx: 1.06 }, { o: 1, sy: 0.88, sx: 1.04 }], { ease: 'ease-in-out' });
  const GO = 1700;
  thief.bob.to(at(GO - 100), 120, { sy: 1, sx: 1 }, { ease: 'ease-out' });
  thief.root.to(at(GO), 520, { x: HITX, rot: fwd(thief, 30) }, { ease: 'cubic-bezier(.6,0,.9,.6)', reduce: 'snap' });
  thief.legF.keys(at(GO), 520, Array.from({ length: 5 }, (_, i) => ({ o: (i + 1) / 5, rot: i % 2 ? -36 : 36 })), { seg: 'linear', ease: 'linear', reduce: 'skip' });
  thief.legB.keys(at(GO), 520, Array.from({ length: 5 }, (_, i) => ({ o: (i + 1) / 5, rot: i % 2 ? 36 : -36 })), { seg: 'linear', ease: 'linear', reduce: 'skip' });
  const HIT = GO + 520;
  thief.face(at(HIT), 'shock');
  thief.legF.to(at(HIT + 40), 200, { rot: 0 });
  thief.legB.to(at(HIT + 40), 200, { rot: 0 });
  gem.track.keys(at(HIT), 500, Array.from({ length: 6 }, (_, i) => ({ o: (i + 1) / 6, x: EMX + (i % 2 ? 1.5 : -1.5) })).concat([{ o: 1, x: EMX }]), { ease: 'linear', reduce: 'skip' });
  cam.shake(at(HIT), 400, 7);
  // recoils, clutching the shoulder
  thief.root.keys(at(HIT + 150), 900, [{ o: 0.4, x: HITX - 60, rot: fwd(thief, -20) }, { o: 1, x: HITX - 90, rot: 0 }], { ease: 'ease-out', reduce: 'snap' });
  thief.armB.to(at(HIT + 300), 300, { rot: -150 }, { ease: 'ease-out' });
  thief.armF.to(at(HIT + 300), 300, { rot: -20 });
  thief.bob.hop(at(HIT + 700), 300, 16);
  thief.face(at(HIT + 600), 'sad');
  const fx =
    pow({ x: 470, y: 330, at: at(HIT + 20), text: 'THUD', scale: 0.55, rot: 6, font: 58, dur: 700 }) +
    rays({ late: true, x: LEFT - 6, y: 470, at: at(HIT), r0: 20, r1: 64, n: 9, dur: 300, width: 5 }) +
    dust({ x: LEFT - 20, y: GY + 4, at: at(HIT), n: 5, spread: 50, r: 20, dir: -1, seed: 9, dur: 800 }) +
    dust({ x: 150, y: GY + 4, at: at(GO), n: 4, spread: 40, r: 18, dir: -1, seed: 4, dur: 600 });
  return cam.html(`${sectionBack(id)}${mat}${gem.html}${thief.html}${sectionFront()}${fx}`);
}

/* ------------------------------------------------------------------ attempt 4: the rope */

export function ropeTry(ctx) {
  const { cues, at, id } = ctx;
  const { cam, gem, mat, thief } = attempt(ctx, { x: 1260, flip: -1, face: 'angry', armF: -10, armB: -10 }, { x: 820, y: 440, s: 1.1 });
  const TIE = { x: RIGHT - 4, y: GY - 128 }; // the rope is tied round the gem's right flank
  // comes in through the hole, takes up the rope's end, and heaves
  thief.walk(at(100), 800, 1088, { stride: 320, amp: 22, bounce: 5, swing: 0 });
  thief.armF.to(at(1000), 320, { rot: -88 }, { ease: 'ease-out' });
  thief.armB.to(at(1000), 320, { rot: -92 }, { ease: 'ease-out' });
  thief.root.to(at(1500), 520, { rot: fwd(thief, -24), x: 1116 }, { ease: 'ease-out', reduce: 'snap' });
  thief.vibrate(at(2100), 900, 3.2);
  thief.legF.keys(at(2100), 900, Array.from({ length: 5 }, (_, i) => ({ o: (i + 1) / 5, rot: i % 2 ? 10 : -22 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  thief.legB.keys(at(2100), 900, Array.from({ length: 5 }, (_, i) => ({ o: (i + 1) / 5, rot: i % 2 ? -22 : 10 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  const SNAP = 3100;
  thief.face(at(SNAP), 'ko');
  thief.root.keys(at(SNAP), 520, [{ o: 1, x: 1190, y: GY - 14, rot: fwd(thief, -84) }], { ease: 'cubic-bezier(.3,0,.8,.7)', reduce: 'snap' });
  thief.armF.to(at(SNAP), 300, { rot: -150 });
  thief.armB.to(at(SNAP), 300, { rot: -160 });
  // the rope runs from the knot on the gem to the thief's hand (it follows the hand), and parts at SNAP
  const rp = connectHose(cues, `${id}.rope`, { thief, anchor: TIE, t0: at(900), t1: at(SNAP), len: 0, rope: true, step: 60 });
  cues.push({ at: at(SNAP), dur: 1, target: `${id}.rope`, keyframes: [{ opacity: 1 }, { opacity: 0 }], easing: 'linear' });
  const knot = `<g transform="translate(${TIE.x} ${TIE.y})"><circle r="13" fill="#d9d9d9" stroke="${INK}" stroke-width="5"/><circle r="4" fill="${INK}"/></g>`;
  const fx =
    drops({ x: 1090, y: 380, at: at(2200), n: 3, seed: 3, spread: 70 }) +
    pow({ x: 1000, y: 300, at: at(SNAP + 10), text: 'SNAP!', scale: 0.55, rot: 8, font: 60, dur: 800 }) +
    dust({ x: 1190, y: GY + 4, at: at(SNAP + 500), n: 5, spread: 50, r: 22, dir: 1, seed: 10, dur: 800 }) +
    dizzy({ x: 1130, y: GY - 120, at: at(SNAP + 600), dur: 1100, rx: 46, ry: 11, count: 3 });
  return cam.html(`${sectionBack(id)}${mat}${gem.html}${knot}${rp}${thief.html}${sectionFront()}${fx}`);
}

/* ------------------------------------------------------------------ kickRun */

export function kickRun(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 640, y: 360, s: 0.95 });
  cam.look(at(400), 2500, { x: -400, y: 400, s: 0.5 }, 'ease-in-out');
  const { gem, mat } = gemOnMat(cues, id);
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 400, y: GY, scale: SC, face: 'angry', goggles: 'up' });

  thief.head.keys(at(0), 400, [{ o: 0.5, rot: fwd(thief, 6) }, { o: 1, rot: 0 }], { ease: 'ease-in-out', reduce: 'skip' });
  thief.face(at(450), 'plot');
  // backs up: and up, and up
  thief.walk(at(400), 2400, -1560, { stride: 460, amp: 22, bounce: 8, swing: 14, ease: 'cubic-bezier(.4,0,.6,1)' });
  // arrives, stretches, sets up like a sprinter
  thief.armF.keys(at(2850), 520, [{ o: 0.5, rot: -150 }, { o: 1, rot: -20 }], { ease: 'ease-in-out' });
  thief.armB.keys(at(2900), 520, [{ o: 0.5, rot: -150 }, { o: 1, rot: -20 }], { ease: 'ease-in-out' });
  thief.face(at(3450), 'angry');
  thief.bob.to(at(3450), 260, { sy: 0.84, sx: 1.06 }, { ease: 'ease-out' });
  thief.root.to(at(3450), 260, { rot: fwd(thief, 20) }, { ease: 'ease-out' });
  thief.armF.to(at(3450), 260, { rot: 60 }, { ease: 'ease-out' });
  thief.armB.to(at(3450), 260, { rot: -60 }, { ease: 'ease-out' });
  thief.legF.to(at(3450), 260, { rot: 28 });
  thief.legB.to(at(3450), 260, { rot: -38 });

  const fx =
    dust({ x: -1560, y: GY + 4, at: at(2800), n: 4, spread: 40, r: 20, dir: 1, seed: 3, dur: 700 }) +
    sparkle({ x: 780, y: 190, at: at(1900), dur: 1000, r: 36, n: 3, s: 1.3 });
  return cam.html(`${sectionBack(id)}${mat}${gem.html}${thief.html}${sectionFront()}${fx}`);
}

/* ------------------------------------------------------------------ kick */

export function kick(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: -400, y: 400, s: 0.5 });
  const { gem, mat } = gemOnMat(cues, id);
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: -1560, y: GY, scale: SC, face: 'angry', goggles: 'up', armF: 60, armB: -60, legF: 28, legB: -38, rot: 20 });
  thief.bob.set(at(0), { sy: 0.84, sx: 1.06 });
  const START = 500; // anticipation: he holds the crouch, then goes
  const JUMP = 1750;
  const HIT = 2090;
  const X_JUMP = 150;
  const X_HIT = LEFT - 6;

  // --- the run: starts slowly, ends in a blur
  thief.bob.to(at(START - 150), 150, { sy: 0.78, sx: 1.1 }, { ease: 'ease-in' });
  thief.root.to(at(START), JUMP - START, { x: X_JUMP, rot: fwd(thief, 12) }, { ease: 'cubic-bezier(.65,0,.9,.5)', reduce: 'snap' });
  thief.bob.to(at(START), 200, { sy: 1, sx: 1 }, { ease: 'ease-out' });
  const steps = 15;
  thief.legF.keys(at(START), JUMP - START, Array.from({ length: steps }, (_, i) => ({ o: (i + 1) / steps, rot: i % 2 ? -46 : 46 })), { seg: 'linear', ease: 'linear', reduce: 'skip' });
  thief.legB.keys(at(START), JUMP - START, Array.from({ length: steps }, (_, i) => ({ o: (i + 1) / steps, rot: i % 2 ? 46 : -46 })), { seg: 'linear', ease: 'linear', reduce: 'skip' });
  thief.armF.keys(at(START), JUMP - START, Array.from({ length: steps }, (_, i) => ({ o: (i + 1) / steps, rot: i % 2 ? 50 : -50 })), { seg: 'linear', ease: 'linear', reduce: 'skip' });
  thief.armB.keys(at(START), JUMP - START, Array.from({ length: steps }, (_, i) => ({ o: (i + 1) / steps, rot: i % 2 ? -50 : 50 })), { seg: 'linear', ease: 'linear', reduce: 'skip' });
  thief.bob.keys(at(START + 200), JUMP - START - 200, Array.from({ length: 10 }, (_, i) => ({ o: (i + 1) / 10, y: i % 2 ? 0 : -16 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  cam.look(at(START + 100), JUMP - START + 150, { x: 330, y: 400, s: 0.88 }, 'cubic-bezier(.5,0,.4,1)');

  // --- the leap: body swings flat, boots first
  thief.legF.to(at(JUMP), 120, { rot: 0 });
  thief.legB.to(at(JUMP), 120, { rot: 0 });
  thief.armF.to(at(JUMP), 260, { rot: -110 }, { ease: 'ease-out' });
  thief.armB.to(at(JUMP), 260, { rot: -70 }, { ease: 'ease-out' });
  thief.face(at(JUMP), 'angry');
  thief.root.keys(at(JUMP), HIT - JUMP, [
    { o: 0.5, x: (X_JUMP + X_HIT) / 2, y: GY - 150, rot: fwd(thief, -48), ease: 'cubic-bezier(.2,.6,.4,1)' },
    { o: 1, x: X_HIT, y: GY - 150, rot: fwd(thief, -84), ease: 'linear' },
  ], { ease: 'linear', reduce: 'snap' });
  thief.legF.to(at(JUMP + 130), 210, { rot: 16 }); // boot leads
  thief.legB.to(at(JUMP + 130), 210, { rot: -24 });

  // --- impact: hit-stop, then BOOOONG
  gem.track.keys(at(HIT), 900, Array.from({ length: 12 }, (_, i) => ({ o: (i + 1) / 12, x: EMX + (i % 2 ? 1 : -1) * 4.5 * (1 - i / 12), sx: 1 + (i % 2 ? 0.012 : -0.008) * (1 - i / 12), sy: 1 })).concat([{ o: 1, x: EMX, sx: 1, sy: 1 }]), { ease: 'linear', reduce: 'skip' });
  cam.shake(at(HIT), 800, 18, 45);

  // --- rebound: flung back, spinning, to a heap with stars
  const REB = HIT + 130;
  const LAND = REB + 880;
  const HX = 300; // where the heap ends up
  thief.face(at(REB), 'ko');
  thief.armF.to(at(REB), 200, { rot: -150 });
  thief.armB.to(at(REB), 200, { rot: -160 });
  thief.root.keys(at(REB), LAND - REB, [
    { o: 0.5, x: 410, y: GY - 320, rot: fwd(thief, -84 - 190), ease: 'cubic-bezier(.2,.7,.4,1)' },
    { o: 1, x: HX, y: GY - 14, rot: fwd(thief, -84 - 360), ease: 'cubic-bezier(.5,0,.9,.6)' },
  ], { ease: 'linear', reduce: 'snap' });
  thief.legF.to(at(LAND - 150), 160, { rot: -80 });
  thief.legB.to(at(LAND - 150), 160, { rot: -104 });
  thief.root.keys(at(LAND), 360, [{ o: 0.4, y: GY - 40, x: HX - 14 }, { o: 1, y: GY - 14, x: HX - 6 }], { ease: 'ease-out', reduce: 'snap' });
  thief.root.set(at(LAND + 400), { rot: fwd(thief, -84) }); // -444 deg is -84 deg: unwind the spin invisibly
  cam.look(at(HIT + 850), 1200, { x: 360, y: 430, s: 0.86 }, 'ease-in-out');
  // dazed: legs flop, he sits up, wobbles
  thief.legF.keys(at(LAND + 500), 900, [{ o: 0.3, rot: -60 }, { o: 0.6, rot: -92 }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear' });
  thief.legB.keys(at(LAND + 500), 900, [{ o: 0.3, rot: -120 }, { o: 0.6, rot: -80 }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear' });
  thief.face(at(LAND + 800), 'sad');
  thief.root.keys(at(LAND + 800), 1200, [
    { o: 0.4, rot: fwd(thief, -50), y: GY - 30 },
    { o: 0.7, rot: fwd(thief, -16), y: GY - 8 },
    { o: 1, rot: 0, y: GY },
  ], { seg: 'ease-in-out', ease: 'linear', reduce: 'snap' });
  thief.armF.to(at(LAND + 800), 600, { rot: -10 });
  thief.armB.to(at(LAND + 800), 600, { rot: 10 });
  thief.root.keys(at(LAND + 2100), 600, [{ o: 0.25, rot: fwd(thief, 5) }, { o: 0.5, rot: fwd(thief, -4) }, { o: 0.75, rot: fwd(thief, 3) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  const trail = [0, 1, 2, 3, 4, 5, 6].map((i) => dust({ x: -1400 + i * 240 + i * i * 24, y: GY + 4, at: at(START + 300 + i * 120), n: 3, spread: 30, r: 22, dir: -1, seed: 20 + i, dur: 600 })).join('');
  const fx =
    trail +
    rings({ x: LEFT + 10, y: GY - 150, at: at(HIT), n: 4, gap: 110, dur: 900, r: 180, width: 8 }) +
    pow({ x: 330, y: 250, at: at(HIT + 10), text: 'BOOOONG!', scale: 1.3, rot: -8, font: 42, dur: 1500 }) +
    rays({ late: true, x: LEFT + 10, y: GY - 150, at: at(HIT), r0: 60, r1: 160, n: 14, dur: 420, width: 7 }) +
    chips({ x: LEFT + 20, y: GY - 150, at: at(HIT), n: 8, power: 160, seed: 5, fill: '#fff', angle: Math.PI, spread: 1.6 }) +
    dust({ x: HX, y: GY + 4, at: at(LAND), n: 8, spread: 120, r: 36, dir: -1, seed: 41, dur: 1100 }) +
    dizzy({ x: HX - 190, y: GY - 80, at: at(LAND + 500), dur: 2200, rx: 60, ry: 14, count: 4 }) +
    sparkle({ x: 780, y: 190, at: at(LAND + 1000), dur: 1000, r: 40, n: 3, s: 1.3 });
  return `${cam.html(`${sectionBack(id)}${mat}${gem.html}${thief.html}${sectionFront()}${fx}`)}${flash({ at: at(HIT), dur: 160, peak: 0.55 })}`;
}
