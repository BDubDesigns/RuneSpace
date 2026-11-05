/**
 * Beats 2 + 3 - Another claimant, and the argument.
 *   rival   : wide. A tall prospector tiptoes in, swaps the sleeping prospector's sign; the signs keep getting replaced.
 *   argue1  : two-shot. Pip points at the mine, then at himself.
 *   argue2  : two-shot. Rex points at the mine, then at himself.
 */
import { prospector } from '../../../art/prospector.js';
import { cutter, mallet, sign, placed } from '../../../art/props.js';
import { dust, sparks, mark, pow, rays, puff, zzz, drops } from '../../../fx/effects.js';
import { Camera, driftClouds, idle, blow, popIn, fwd } from '../../../kit.js';
import { frontBack, frontFore, cactus } from '../world.js';
import { TEXT } from '../config.js';

const GY = 604;
const SIGN_Y = 606;

/** The steady-state staging shared by the argument shots (signs planted between them). */
function twoShot(ctx, { pip = {}, rex = {} } = {}) {
  const { cues, id } = ctx;
  const p = prospector(cues, `${id}.pip`, { kind: 'pip', x: 500, y: GY, scale: 0.92, pack: true, props: { F: cutter(`${id}.cut`) }, face: 'normal', armF: -10, ...pip });
  const r = prospector(cues, `${id}.rex`, { kind: 'rex', x: 790, y: GY, scale: 0.88, flip: -1, props: { F: mallet() }, face: 'normal', armF: -28, ...rex });
  const s1 = placed(cues, `${id}.p2`, sign('pip', TEXT.sign), { x: 650, y: SIGN_Y, rot: 2 });
  const s2 = placed(cues, `${id}.r2`, sign('rex', TEXT.sign), { x: 708, y: SIGN_Y, rot: -2 });
  return { p, r, s1, s2 };
}

export function rival(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: 430, y: GY, scale: 0.92, pack: true, face: 'sleep', props: { F: cutter(`${id}.cut`) }, armF: -10 });
  const rex = prospector(cues, `${id}.rex`, { kind: 'rex', x: 1500, y: GY, scale: 0.88, flip: -1, face: 'smug', props: { F: mallet() }, armF: -28 });
  const P1 = placed(cues, `${id}.p1`, sign('pip', TEXT.sign), { x: 660, y: SIGN_Y });
  const R1 = placed(cues, `${id}.r1`, sign('rex', TEXT.sign), { x: 660, y: 540, sx: 0, sy: 0 });
  const P2 = placed(cues, `${id}.p2`, sign('pip', TEXT.sign), { x: 650, y: 540, sx: 0, sy: 0 });
  const R2 = placed(cues, `${id}.r2`, sign('rex', TEXT.sign), { x: 708, y: 540, sx: 0, sy: 0 });
  driftClouds(ctx, id);

  // --- Pip dozes on his claim
  pip.head.set(at(0), { rot: 14 });
  idle(pip, 0, 3300, 1100);

  // --- Rex tiptoes in, spots the sign, schemes
  rex.walk(at(0), 1400, 790, { stride: 800, amp: 18, bounce: 3, swing: 8 });
  rex.walk(at(1900), 300, 770, { stride: 300, amp: 16, bounce: 3, swing: 0 });
  rex.face(at(1400), 'shock');
  rex.head.to(at(1400), 200, { rot: fwd(rex, 10) });
  rex.face(at(1650), 'plot');
  rex.bob.hop(at(1650), 260, 16);

  // --- yank Pip's sign, hurl it away
  rex.armB.to(at(1950), 150, { rot: -78 }, { ease: 'ease-out' });
  P1.track.keys(at(2100), 220, [{ o: 1, y: 470, rot: -14 }], { ease: 'ease-out' });
  rex.armB.to(at(2300), 130, { rot: -160 }, { ease: 'ease-out' });
  P1.track.keys(at(2340), 800, [
    { o: 0.45, x: 330, y: 170, rot: -320, ease: 'cubic-bezier(.2,.7,.4,1)' },
    { o: 1, x: -200, y: 560, rot: -650, ease: 'cubic-bezier(.5,0,.9,.6)' },
  ], { ease: 'linear', reduce: 'snap' });
  rex.armB.to(at(2560), 220, { rot: 0 });
  rex.face(at(2560), 'smug');

  // --- plants his own sign: pop, two blows
  popIn(R1, at(2560), 660, 530);
  const hit1 = blow(rex, at(2700));
  R1.track.to(hit1, 90, { y: 578 }, { ease: 'ease-out' });
  const hit2 = blow(rex, at(3130));
  R1.track.to(hit2, 90, { y: SIGN_Y }, { ease: 'ease-out' });
  rex.armF.to(at(3500), 240, { rot: -28 });
  rex.root.to(at(3500), 200, { rot: 0 });
  rex.fold(at(3560));
  rex.head.to(at(3560), 240, { rot: fwd(rex, -6) });
  rex.bob.keys(at(3560), 1000, [{ o: 0.25, sy: 1.02 }, { o: 0.5, sy: 1 }, { o: 0.75, sy: 1.02 }, { o: 1, sy: 1 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  // --- Pip wakes up
  pip.face(at(3300), 'normal');
  pip.head.to(at(3300), 260, { rot: 0 });
  pip.face(at(3750), 'shock');
  pip.bob.hop(at(3750), 300, 36);
  pip.armF.to(at(3750), 150, { rot: -120 }, { ease: 'cubic-bezier(.2,1.5,.4,1)' });
  pip.face(at(4050), 'angry');
  pip.yap(at(4050), 1400);
  pip.armF.to(at(4050), 200, { rot: 0 });

  // --- charges over, yanks Rex's sign, flings it the other way
  pip.walk(at(4150), 330, 530, { stride: 220, amp: 36, bounce: 6, swing: 26 });
  pip.armB.to(at(4500), 140, { rot: -78 }, { ease: 'ease-out' });
  R1.track.keys(at(4600), 200, [{ o: 1, y: 470, rot: 12 }], { ease: 'ease-out' });
  rex.fold(at(4650), false);
  rex.face(at(4650), 'shock');
  pip.armB.to(at(4760), 130, { rot: -160 }, { ease: 'ease-out' });
  R1.track.keys(at(4800), 850, [
    { o: 0.45, x: 1000, y: 150, rot: 330, ease: 'cubic-bezier(.2,.7,.4,1)' },
    { o: 1, x: 1400, y: 560, rot: 700, ease: 'cubic-bezier(.5,0,.9,.6)' },
  ], { ease: 'linear', reduce: 'snap' });
  pip.armB.to(at(5000), 220, { rot: 0 });

  // --- slams his own sign back in. With the butt of his mining cutter. (Remember that.)
  pip.face(at(5000), 'plot');
  popIn(P2, at(5000), 650, 500);
  pip.propF.to(at(5050), 200, { rot: -90 });
  const hitP = blow(pip, at(5150), 250, 90);
  P2.track.to(hitP, 90, { y: SIGN_Y }, { ease: 'ease-in' });
  pip.squash(hitP, 220, 0.86, 1.1);
  pip.propF.to(hitP + 150, 300, { rot: 0 });
  pip.armF.to(hitP + 150, 300, { rot: -14 });

  // --- Rex answers with a second sign. Nobody blinks.
  rex.face(at(5550), 'angry');
  popIn(R2, at(5450), 708, 520);
  const hit3 = blow(rex, at(5500), 200, 80);
  R2.track.to(hit3, 90, { y: SIGN_Y }, { ease: 'ease-out' });
  pip.face(at(5900), 'angry');
  pip.root.to(at(5900), 220, { rot: fwd(pip, 8) });
  rex.root.to(at(5900), 220, { rot: fwd(rex, 8) });

  const fx =
    zzz({ x: 462, y: 420, at: at(0), dur: 3300 }) +
    sparks({ x: 660, y: 500, at: at(2580), n: 8, power: 70, angle: 0, spread: Math.PI * 2, seed: 4, size: 0.9 }) +
    puff({ x: 660, y: 500, at: at(2560), dur: 480, r: 34, dy: -16 }) +
    [hit1, hit2].map((t, i) => rays({ x: 668, y: 585, at: t, r0: 14, r1: 40, n: 8, dur: 280, width: 5 }) + dust({ x: 668, y: SIGN_Y + 4, at: t, n: 3, spread: 28, r: 16, seed: 31 + i, dur: 600 }) + pow({ x: 700, y: 440, at: t + 20, text: ['TOK', 'TOK!'][i], scale: 0.38 + i * 0.07, rot: [-8, 7][i], font: 58, dur: 460 })).join('') +
    mark({ x: 540, y: 330, at: at(3750), text: '?!', dur: 1000, size: 90 }) +
    sparks({ x: 650, y: 480, at: at(5010), n: 8, power: 70, angle: 0, spread: Math.PI * 2, seed: 6, size: 0.9 }) +
    puff({ x: 650, y: 490, at: at(5000), dur: 480, r: 34, dy: -16 }) +
    dust({ x: 650, y: SIGN_Y + 4, at: hitP, n: 4, spread: 36, r: 18, seed: 8, dur: 700 }) +
    pow({ x: 600, y: 400, at: hitP + 20, text: 'THONK!', scale: 0.46, rot: -7, font: 58, dur: 560 }) +
    sparks({ x: 708, y: 490, at: at(5460), n: 8, power: 70, angle: 0, spread: Math.PI * 2, seed: 12, size: 0.9 }) +
    dust({ x: 708, y: SIGN_Y + 4, at: hit3, n: 3, spread: 28, r: 16, seed: 41, dur: 600 }) +
    // steam out of both heads
    [0, 1, 2, 3].map((i) => puff({ x: 480 + (i % 2) * 90, y: 400, at: at(6000 + i * 150), dur: 700, r: 22, dy: -50, dx: i % 2 ? 24 : -24 })).join('') +
    [0, 1, 2].map((i) => puff({ x: 745 + (i % 2) * 40, y: 350, at: at(6050 + i * 170), dur: 700, r: 22, dy: -50, dx: i % 2 ? 24 : -24 })).join('') +
    drops({ x: 560, y: 410, at: at(5950), n: 2, seed: 2 });

  return cam.html(`${frontBack(id)}${cactus(150)}${P1.html}${R1.html}${P2.html}${R2.html}${pip.html}${rex.html}${frontFore()}${fx}`);
}

/* ------------------------------------------------------------ the argument */

export function argue1(ctx) {
  const { cues, at, id } = ctx;
  const { p, r, s1, s2 } = twoShot(ctx);
  const cam = new Camera(cues, id, { x: 640, y: 470, s: 1.7 });
  // Each emphasis beat nudges the camera a little closer to the speaker's face. Nobody leaves the ground.
  const punch = (t, f) => cam.look(at(t), 240, f, 'cubic-bezier(.2,.9,.3,1)');
  punch(100, { x: 626, y: 458, s: 1.82 });
  punch(1000, { x: 602, y: 454, s: 1.95 });
  punch(1400, { x: 580, y: 450, s: 2.1 });
  driftClouds(ctx, id);

  r.fold(at(0));
  r.face(at(0), 'smug');
  r.face(at(1900), 'angry');
  p.face(at(0), 'angry');
  p.yap(at(0), 2300, 120);

  // "THAT MINE..." (points at the mine)  "...is MINE!" (points at himself, twice)
  p.armB.to(at(80), 160, { rot: -88 }, { ease: 'cubic-bezier(.2,1.4,.4,1)' });
  p.head.keys(at(80), 700, [{ o: 0.2, rot: fwd(p, 6) }, { o: 0.5, rot: fwd(p, -3) }, { o: 1, rot: 0 }], { seg: 'ease-out', ease: 'linear', reduce: 'skip' });
  p.armB.to(at(900), 150, { rot: -40 }, { ease: 'ease-out' });
  p.armB.to(at(1300), 100, { rot: -26 });
  p.armB.to(at(1400), 110, { rot: -42 }, { ease: 'ease-out' });
  p.armB.to(at(1750), 240, { rot: 0 });
  p.root.to(at(1700), 600, { x: 530 }, { ease: 'ease-out', reduce: 'snap' });
  p.vibrate(at(1500), 800, 2);

  r.head.keys(at(0), 1900, [{ o: 0.3, rot: fwd(r, -5) }, { o: 0.6, rot: fwd(r, 3) }, { o: 1, rot: fwd(r, -4) }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  r.bob.keys(at(0), 1900, Array.from({ length: 6 }, (_, i) => ({ o: (i + 1) / 6, y: i % 2 ? 0 : -3 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' }); // foot-tapping

  const fx = drops({ x: 560, y: 410, at: at(1000), n: 2, seed: 1 }) +
    puff({ x: 800, y: 340, at: at(1950), dur: 600, r: 20, dy: -46, dx: 20 }) + puff({ x: 760, y: 340, at: at(2050), dur: 600, r: 20, dy: -46, dx: -18 });
  return cam.html(`${frontBack(id)}${cactus(150)}${s1.html}${s2.html}${p.html}${r.html}${frontFore()}${fx}`);
}

export function argue2(ctx) {
  const { cues, at, id } = ctx;
  const { p, r, s1, s2 } = twoShot(ctx);
  const cam = new Camera(cues, id, { x: 650, y: 462, s: 1.9 });
  const punch = (t, f) => cam.look(at(t), 240, f, 'cubic-bezier(.2,.9,.3,1)');
  punch(100, { x: 686, y: 442, s: 2.02 });
  punch(1000, { x: 712, y: 430, s: 2.15 });
  punch(1400, { x: 734, y: 420, s: 2.3 });
  driftClouds(ctx, id);

  p.fold(at(0));
  p.face(at(0), 'smug');
  p.face(at(1900), 'angry');
  p.root.to(at(1900), 300, { x: 540, rot: fwd(p, 8) });
  r.face(at(0), 'angry');
  r.yap(at(0), 2300, 115);

  // "NO!" - thumb jerked back at the mine, then jabbing at his own chest
  r.armB.to(at(80), 160, { rot: 95 }, { ease: 'cubic-bezier(.2,1.4,.4,1)' });
  r.armB.to(at(900), 150, { rot: -38 }, { ease: 'ease-out' });
  r.armB.to(at(1300), 100, { rot: -24 });
  r.armB.to(at(1400), 110, { rot: -40 }, { ease: 'ease-out' });
  r.armB.to(at(1750), 240, { rot: 0 });
  r.root.to(at(1900), 300, { x: 740, rot: fwd(r, 8) });
  r.head.keys(at(0), 1900, [{ o: 0.3, rot: fwd(r, 5) }, { o: 0.6, rot: fwd(r, -3) }, { o: 1, rot: fwd(r, 4) }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  p.head.keys(at(0), 1900, [{ o: 0.4, rot: fwd(p, 4) }, { o: 0.7, rot: fwd(p, -5) }, { o: 1, rot: fwd(p, 3) }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  const fx = drops({ x: 780, y: 360, at: at(1000), n: 2, seed: 5 }) +
    [0, 1, 2].map((i) => puff({ x: 520 + i * 36, y: 410, at: at(2000 + i * 120), dur: 560, r: 18, dy: -44, dx: i % 2 ? 18 : -18 })).join('');
  return cam.html(`${frontBack(id)}${cactus(150)}${s1.html}${s2.html}${p.html}${r.html}${frontFore()}${fx}`);
}

export { twoShot, GY, SIGN_Y };
