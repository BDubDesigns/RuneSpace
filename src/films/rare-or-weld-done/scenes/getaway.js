/**
 * Beat 3 - The impossible getaway (cut-away view of the gallery: Emerald in the middle, the hole at the right).
 *   sack    : a tiny sack. He pushes. He shoulders it. He tries a rope. Nothing.
 *   kickRun : he backs up. And up. And up.
 *   kick    : the run, the JUMP-KICK, BOOOONG, the rebound, the heap with stars.
 */
import { prospector } from '../../../art/prospector.js';
import { swagSack } from '../../../art/weld.js';
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

const ropeLine = () => `<rect x="0" y="-5" width="1" height="10" fill="#d6d6d6" stroke="${INK}" stroke-width="3.4" vector-effect="non-scaling-stroke"/>`;

/* ------------------------------------------------------------------ sack */

export function sack(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 540, y: 330, s: 0.92 });
  const { gem, mat } = gemOnMat(cues, id);
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 300, y: GY, scale: SC, face: 'normal', goggles: 'up', props: { F: swagSack() }, armF: -60 });
  const ropeP = placed(cues, `${id}.rope`, ropeLine(), { x: RIGHT - 6, y: GY - 130, sx: 0.01 });
  const shudder = (t, n, px) => gem.track.keys(at(t), n * 110, Array.from({ length: n }, (_, i) => ({ o: (i + 1) / n, x: EMX + (i % 2 ? px : -px) })).concat([{ o: 1, x: EMX }]), { ease: 'linear', reduce: 'skip' });

  // --- 1. the sack: it is obviously too small
  thief.walk(at(100), 350, 360, { stride: 300, amp: 16, bounce: 5, swing: 0 });
  thief.armF.to(at(480), 260, { rot: -96 }, { ease: 'ease-out' });
  thief.face(at(480), 'smug');
  thief.face(at(850), 'glance');
  thief.head.to(at(850), 200, { rot: fwd(thief, 8) });
  thief.face(at(1250), 'normal');
  thief.head.to(at(1250), 200, { rot: fwd(thief, -6) });
  thief.face(at(1550), 'sad');
  thief.armF.to(at(1650), 260, { rot: -30 }, { ease: 'ease-in-out' });
  show(cues, `${id}.thief.propF`, at(1950), false);

  // --- 2. push
  const PUSH = 2050;
  thief.face(at(PUSH), 'angry');
  thief.walk(at(PUSH), 340, 410, { stride: 200, amp: 24, bounce: 4, swing: 0 });
  thief.armF.to(at(PUSH), 300, { rot: -86 }, { ease: 'ease-out' });
  thief.armB.to(at(PUSH), 300, { rot: -90 }, { ease: 'ease-out' });
  thief.root.to(at(PUSH + 340), 260, { rot: fwd(thief, 22) }, { ease: 'ease-out' });
  thief.legF.keys(at(PUSH + 340), 800, Array.from({ length: 6 }, (_, i) => ({ o: (i + 1) / 6, rot: i % 2 ? 26 : -8 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  thief.legB.keys(at(PUSH + 340), 800, Array.from({ length: 6 }, (_, i) => ({ o: (i + 1) / 6, rot: i % 2 ? -8 : 26 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  thief.vibrate(at(PUSH + 340), 800, 3);
  shudder(PUSH + 340, 8, 1.5);
  const GIVE = PUSH + 1150;
  thief.face(at(GIVE), 'sad');
  thief.root.to(at(GIVE), 250, { rot: 0 }, { ease: 'ease-in-out' });
  thief.legF.to(at(GIVE), 200, { rot: 0 });
  thief.legB.to(at(GIVE), 200, { rot: 0 });
  thief.armF.to(at(GIVE), 300, { rot: -10 });
  thief.armB.to(at(GIVE), 300, { rot: 0 });

  // --- 3. the shoulder
  const SH = GIVE + 550;
  thief.face(at(SH - 250), 'plot');
  thief.walk(at(SH - 250), 250, 300, { stride: 220, amp: 20, bounce: 3, swing: 0 });
  thief.walk(at(SH), 240, 440, { stride: 160, amp: 36, bounce: 5, swing: 0 });
  thief.torso.to(at(SH), 240, { rot: fwd(thief, 26) }, { ease: 'ease-in' });
  const HIT = SH + 240;
  thief.face(at(HIT), 'shock');
  thief.torso.to(at(HIT), 180, { rot: 0 }, { ease: 'ease-out' });
  thief.root.keys(at(HIT), 500, [{ o: 0.4, x: 380, rot: fwd(thief, -22) }, { o: 1, x: 340, rot: 0 }], { ease: 'ease-out', reduce: 'snap' });
  thief.armB.to(at(HIT + 150), 200, { rot: -150 }, { ease: 'ease-out' }); // clutches the shoulder
  thief.legF.to(at(HIT + 100), 160, { rot: 0 });
  thief.legB.to(at(HIT + 100), 160, { rot: 0 });
  thief.bob.hop(at(HIT + 250), 260, 14);
  gem.track.keys(at(HIT), 420, Array.from({ length: 6 }, (_, i) => ({ o: (i + 1) / 6, x: EMX + (i % 2 ? 1.2 : -1.2) })).concat([{ o: 1, x: EMX }]), { ease: 'linear', reduce: 'skip' });
  cam.shake(at(HIT), 300, 6);

  // --- 4. the rope: he walks round to the hole side (still clutching the shoulder) and heaves
  const WALK = HIT + 550;
  thief.face(at(WALK), 'angry');
  thief.walk(at(WALK), 600, 1085, { stride: 380, amp: 22, bounce: 5, swing: 0 });
  cam.look(at(WALK), 1100, { x: 780, y: 330, s: 0.92 }, 'ease-in-out');
  const ROPE = WALK + 600;
  thief.root.to(at(ROPE), 150, { flip: -1 }, { ease: 'ease-in-out', reduce: 'snap' });
  thief.armF.to(at(ROPE), 220, { rot: -86 }, { ease: 'ease-out' });
  thief.armB.to(at(ROPE), 220, { rot: -92 }, { ease: 'ease-out' });
  const handX = (x) => x - 92;
  tween(cues, `${id}.rope`, at(ROPE + 150), 1, { opacity: 0 }, { opacity: 1 });
  ropeP.track.set(at(ROPE + 150), { x: RIGHT - 6, y: GY - 128, sx: handX(1085) - (RIGHT - 6) });
  thief.root.to(at(ROPE + 300), 460, { rot: fwd(thief, -26), x: 1112 }, { ease: 'ease-out', reduce: 'snap' });
  ropeP.track.to(at(ROPE + 300), 460, { sx: handX(1112) - (RIGHT - 6) - 18, rot: -1.5 }, { ease: 'ease-out', reduce: 'snap' });
  thief.vibrate(at(ROPE + 700), 700, 3.2);
  thief.legF.keys(at(ROPE + 700), 700, Array.from({ length: 5 }, (_, i) => ({ o: (i + 1) / 5, rot: i % 2 ? 10 : -22 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  thief.legB.keys(at(ROPE + 700), 700, Array.from({ length: 5 }, (_, i) => ({ o: (i + 1) / 5, rot: i % 2 ? -22 : 10 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  const SNAP = ROPE + 1400;
  show(cues, `${id}.rope`, at(SNAP), false);
  thief.root.keys(at(SNAP), 420, [{ o: 1, x: 1180, y: GY - 14, rot: fwd(thief, -84) }], { ease: 'cubic-bezier(.3,0,.8,.7)', reduce: 'snap' });
  thief.face(at(SNAP), 'ko');

  const fx =
    sparkle({ x: 760, y: 190, at: at(300), dur: 1000, r: 34, n: 5, s: 1.3 }) +
    mark({ x: 400, y: 350, at: at(1550), text: '?', dur: 900, size: 84 }) +
    dust({ x: 380, y: GY + 4, at: at(PUSH + 500), n: 4, spread: 40, r: 18, dir: -1, seed: 7, dur: 700 }) +
    drops({ x: 460, y: 380, at: at(PUSH + 900), n: 3, seed: 8, spread: 70 }) +
    pow({ x: 360, y: 330, at: at(PUSH + 450), text: 'HNNG!', scale: 0.5, rot: -8, font: 58, dur: 800 }) +
    pow({ x: 470, y: 330, at: at(HIT + 10), text: 'THUD', scale: 0.46, rot: 6, font: 58, dur: 600 }) +
    rays({ x: 495, y: 470, at: at(HIT), r0: 20, r1: 60, n: 9, dur: 280, width: 5 }) +
    dust({ x: 470, y: GY + 4, at: at(HIT), n: 4, spread: 40, r: 20, dir: -1, seed: 9, dur: 700 }) +
    drops({ x: 1090, y: 380, at: at(ROPE + 1000), n: 3, seed: 3, spread: 70 }) +
    pow({ x: 1020, y: 300, at: at(SNAP + 10), text: 'SNAP!', scale: 0.55, rot: 8, font: 60, dur: 700 }) +
    dust({ x: 1170, y: GY + 4, at: at(SNAP + 380), n: 5, spread: 50, r: 22, dir: 1, seed: 10, dur: 800 }) +
    dizzy({ x: 1130, y: GY - 120, at: at(SNAP + 450), dur: 1000, rx: 46, ry: 11, count: 3 });
  return cam.html(`${sectionBack(id)}${mat}${gem.html}${ropeP.html}${thief.html}${sectionFront()}${fx}`);
}

/* ------------------------------------------------------------------ kickRun */

export function kickRun(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 640, y: 360, s: 0.95 });
  cam.look(at(400), 2900, { x: -400, y: 400, s: 0.5 }, 'ease-in-out');
  const { gem, mat } = gemOnMat(cues, id);
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 400, y: GY, scale: SC, face: 'angry', goggles: 'up' });

  thief.head.keys(at(0), 400, [{ o: 0.5, rot: fwd(thief, 6) }, { o: 1, rot: 0 }], { ease: 'ease-in-out', reduce: 'skip' });
  thief.face(at(450), 'plot');
  // backs up: and up, and up
  thief.walk(at(400), 2800, -1560, { stride: 460, amp: 22, bounce: 8, swing: 14, ease: 'cubic-bezier(.4,0,.6,1)' });
  // arrives, stretches, sets up like a sprinter
  thief.armF.keys(at(3250), 520, [{ o: 0.5, rot: -150 }, { o: 1, rot: -20 }], { ease: 'ease-in-out' });
  thief.armB.keys(at(3300), 520, [{ o: 0.5, rot: -150 }, { o: 1, rot: -20 }], { ease: 'ease-in-out' });
  thief.face(at(3850), 'angry');
  thief.bob.to(at(3850), 260, { sy: 0.84, sx: 1.06 }, { ease: 'ease-out' });
  thief.root.to(at(3850), 260, { rot: fwd(thief, 20) }, { ease: 'ease-out' });
  thief.armF.to(at(3850), 260, { rot: 60 }, { ease: 'ease-out' });
  thief.armB.to(at(3850), 260, { rot: -60 }, { ease: 'ease-out' });
  thief.legF.to(at(3850), 260, { rot: 28 });
  thief.legB.to(at(3850), 260, { rot: -38 });

  const fx =
    dust({ x: -1560, y: GY + 4, at: at(3200), n: 4, spread: 40, r: 20, dir: 1, seed: 3, dur: 700 }) +
    sparkle({ x: 780, y: 190, at: at(2200), dur: 1000, r: 36, n: 3, s: 1.3 });
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
  thief.legF.keys(at(LAND + 700), 900, [{ o: 0.3, rot: -60 }, { o: 0.6, rot: -92 }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear' });
  thief.legB.keys(at(LAND + 700), 900, [{ o: 0.3, rot: -120 }, { o: 0.6, rot: -80 }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear' });
  thief.face(at(LAND + 1000), 'sad');
  thief.root.keys(at(LAND + 1100), 1300, [
    { o: 0.4, rot: fwd(thief, -50), y: GY - 30 },
    { o: 0.7, rot: fwd(thief, -16), y: GY - 8 },
    { o: 1, rot: 0, y: GY },
  ], { seg: 'ease-in-out', ease: 'linear', reduce: 'snap' });
  thief.armF.to(at(LAND + 1100), 600, { rot: -10 });
  thief.armB.to(at(LAND + 1100), 600, { rot: 10 });
  thief.root.keys(at(LAND + 2500), 800, [{ o: 0.25, rot: fwd(thief, 5) }, { o: 0.5, rot: fwd(thief, -4) }, { o: 0.75, rot: fwd(thief, 3) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  const trail = [0, 1, 2, 3, 4, 5, 6].map((i) => dust({ x: -1400 + i * 240 + i * i * 24, y: GY + 4, at: at(START + 300 + i * 120), n: 3, spread: 30, r: 22, dir: -1, seed: 20 + i, dur: 600 })).join('');
  const fx =
    trail +
    flash({ at: at(HIT), dur: 220, peak: 0.95, w: 4000, h: 3000 }) +
    rings({ x: LEFT + 10, y: GY - 150, at: at(HIT), n: 4, gap: 110, dur: 900, r: 180, width: 8 }) +
    pow({ x: 330, y: 230, at: at(HIT + 10), text: 'BOOOONG!', scale: 1.35, rot: -8, font: 50, dur: 1500 }) +
    rays({ x: LEFT + 10, y: GY - 150, at: at(HIT), r0: 60, r1: 160, n: 14, dur: 420, width: 7 }) +
    chips({ x: LEFT + 20, y: GY - 150, at: at(HIT), n: 8, power: 160, seed: 5, fill: '#fff', angle: Math.PI, spread: 1.6 }) +
    dust({ x: HX, y: GY + 4, at: at(LAND), n: 8, spread: 120, r: 36, dir: -1, seed: 41, dur: 1100 }) +
    dizzy({ x: HX - 190, y: GY - 80, at: at(LAND + 500), dur: 2800, rx: 60, ry: 14, count: 4 }) +
    sparkle({ x: 780, y: 190, at: at(LAND + 1200), dur: 1000, r: 40, n: 3, s: 1.3 });
  return cam.html(`${sectionBack(id)}${mat}${gem.html}${thief.html}${sectionFront()}${fx}`);
}
