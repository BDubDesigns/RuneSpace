/**
 * Beat 4 - The bonk.
 *   idea : close-up. The first prospector's eyes slide down to his mining cutter. A horned bulb pops.
 *   bonk : wide. Wind-up, hold, BONK, X eyes, topple, drag him behind the mine.
 */
import { prospector } from '../../../art/prospector.js';
import { cutter, mallet, sign, placed } from '../../../art/props.js';
import { dust, sparks, chips, pow, rays, dizzy, badIdea, flash, drops, puff } from '../../../fx/effects.js';
import { Camera, driftClouds, fwd } from '../../../kit.js';
import { frontBack, frontFore, cactus, sunburst } from '../world.js';
import { tween } from '../../../acting.js';
import { TEXT } from '../config.js';

const GY = 604;

export function idea(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 640, y: 360, s: 1 });
  cam.look(at(0), ctx.dur, { x: 640, y: 350, s: 1.1 }, 'linear');
  tween(cues, `${id}.bg.burst`, at(0), ctx.dur, { transform: 'rotate(0deg)' }, { transform: 'rotate(14deg)' }, { reduce: 'skip' });
  const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: 600, y: 790, scale: 2.7, pack: true, face: 'angry', props: { F: cutter(`${id}.cut`) }, armF: -14 });

  pip.yap(at(0), 460, 110);
  pip.head.keys(at(0), 480, [{ o: 0.3, rot: fwd(pip, 5) }, { o: 0.6, rot: fwd(pip, -4) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  pip.face(at(520), 'normal');
  pip.bob.keys(at(520), 300, [{ o: 0.5, sy: 0.985 }, { o: 1, sy: 1 }], { ease: 'ease-out', reduce: 'skip' });
  pip.face(at(900), 'glance'); // eyes slide down to the cutter
  pip.head.to(at(900), 320, { rot: fwd(pip, 9) }, { ease: 'ease-out' });
  pip.armF.to(at(1150), 360, { rot: -52 }, { ease: 'ease-in-out' });
  pip.face(at(1550), 'plot'); // the grin of a man with a terrible plan
  pip.head.to(at(1550), 420, { rot: fwd(pip, -4) });
  pip.bob.keys(at(1550), 700, [{ o: 0.5, sy: 1.012 }, { o: 1, sy: 1 }], { ease: 'ease-in-out', reduce: 'skip' });
  pip.vibrate(at(1750), 700, 2.4);

  const fx = badIdea({ x: 915, y: 190, at: at(1500), dur: 1100, scale: 1.7 });
  return `${sunburst(`${id}.bg`)}${cam.html(`${pip.html}${fx}`)}`;
}

export function bonk(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: 690, y: GY, scale: 0.92, pack: true, face: 'plot', props: { F: cutter(`${id}.cut`) }, armF: -14 });
  const rex = prospector(cues, `${id}.rex`, { kind: 'rex', x: 850, y: GY, scale: 0.88, flip: -1, face: 'angry', props: { F: mallet() }, armF: -28 });
  const s1 = placed(cues, `${id}.p2`, sign('pip', TEXT.sign), { x: 560, y: 606, rot: 2 });
  const s2 = placed(cues, `${id}.r2`, sign('rex', TEXT.sign), { x: 612, y: 606, rot: -2 });
  driftClouds(ctx, id);

  // --- Rex rants, oblivious
  rex.yap(at(0), 1800, 120);
  rex.armB.keys(at(0), 1900, [{ o: 0.15, rot: -88 }, { o: 0.3, rot: -62 }, { o: 0.45, rot: -88 }, { o: 0.6, rot: -62 }, { o: 0.75, rot: -88 }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear' });
  rex.head.keys(at(0), 1900, [{ o: 0.25, rot: fwd(rex, 6) }, { o: 0.5, rot: fwd(rex, -3) }, { o: 0.75, rot: fwd(rex, 5) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  rex.bob.hop(at(300), 240, 10);
  rex.bob.hop(at(900), 240, 10);
  rex.face(at(1900), 'normal'); // runs out of breath

  // --- Pip slowly raises the cutter behind Rex's rant
  pip.head.keys(at(0), 600, [{ o: 0.5, rot: fwd(pip, 4) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  pip.propF.to(at(500), 1000, { rot: -90 });
  pip.armF.to(at(500), 1000, { rot: -168 }, { ease: 'ease-in-out' });
  pip.root.to(at(500), 1000, { rot: fwd(pip, -7) }, { ease: 'ease-in-out' });
  pip.face(at(1500), 'plot');
  cam.look(at(700), 1250, { x: 790, y: 440, s: 1.22 }, 'ease-in-out');

  // --- crouch... SWING
  pip.bob.to(at(1850), 130, { sy: 0.9, sx: 1.06 }, { ease: 'ease-out' });
  pip.bob.to(at(1980), 90, { sy: 1, sx: 1 });
  pip.armF.to(at(1990), 100, { rot: -14 }, { ease: 'cubic-bezier(.6,0,1,.5)' });
  pip.root.to(at(1990), 110, { x: 756, rot: fwd(pip, 12) }, { ease: 'ease-in' });
  pip.legF.to(at(1990), 110, { rot: 22 });
  pip.legB.to(at(1990), 110, { rot: -22 });
  const IMPACT = 2100;

  // --- BONK (impact frame, hit-stop, squash)
  rex.face(at(IMPACT + 70), 'ko');
  rex.head.keys(at(IMPACT), 220, [{ o: 0.3, sy: 0.62, sx: 1.18 }, { o: 1, sy: 1, sx: 1 }], { ease: 'ease-out', reduce: 'skip' });
  rex.bob.keys(at(IMPACT), 260, [{ o: 0.3, sy: 0.82, sx: 1.12 }, { o: 1, sy: 1, sx: 1 }], { ease: 'ease-out', reduce: 'skip' });
  rex.hat.keys(at(IMPACT + 20), 760, [{ o: 1, y: -1500, rot: -720 }], { ease: 'cubic-bezier(.15,.8,.35,1)', reduce: 'snap' });
  cam.shake(at(IMPACT), 480, 15);
  pip.face(at(IMPACT + 150), 'smug');
  pip.legF.to(at(IMPACT + 500), 200, { rot: 0 });
  pip.legB.to(at(IMPACT + 500), 200, { rot: 0 });
  pip.armF.to(at(IMPACT + 600), 450, { rot: -34 }, { ease: 'ease-in-out' });
  pip.propF.to(at(IMPACT + 600), 450, { rot: 0 });
  pip.root.to(at(IMPACT + 600), 450, { rot: 0 });

  // --- dazed sway
  rex.root.keys(at(2350), 950, [{ o: 0.25, rot: fwd(rex, 5) }, { o: 0.5, rot: fwd(rex, -5) }, { o: 0.75, rot: fwd(rex, 4) }, { o: 1, rot: fwd(rex, -2) }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  rex.head.keys(at(2350), 950, [{ o: 0.25, rot: fwd(rex, -10) }, { o: 0.5, rot: fwd(rex, 8) }, { o: 0.75, rot: fwd(rex, -8) }, { o: 1, rot: fwd(rex, 3) }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  // --- timber! stiff as a plank, away from Pip
  rex.root.keys(at(3350), 460, [
    { o: 0.8, rot: 96, y: 566, ease: 'cubic-bezier(.5,0,.9,.6)' },
    { o: 1, rot: 90, y: 568, ease: 'ease-out' },
  ], { ease: 'linear', reduce: 'snap' });
  rex.armF.to(at(3350), 300, { rot: 40 });
  rex.armB.to(at(3350), 300, { rot: -40 });
  const FALL = 3350 + 368;
  cam.shake(at(FALL), 300, 8);

  // --- Pip dusts off his hands, thinks, collects the body
  pip.face(at(3900), 'cheer');
  [0, 1, 2].forEach((i) => {
    pip.armB.to(at(3950 + i * 220), 100, { rot: i % 2 ? 40 : -50 });
    pip.armF.to(at(3950 + i * 220), 100, { rot: i % 2 ? -50 : 40 });
  });
  pip.armF.to(at(4650), 150, { rot: 0 });
  pip.armB.to(at(4650), 150, { rot: 0 });
  pip.face(at(4650), 'glance');
  pip.head.to(at(4650), 200, { rot: fwd(pip, 12) });
  pip.face(at(5000), 'plot');
  pip.head.to(at(5000), 200, { rot: 0 });
  pip.walk(at(4950), 330, 802, { stride: 260, amp: 24, bounce: 4, swing: 0 });
  pip.root.to(at(5330), 170, { flip: -1 }, { ease: 'ease-in-out' });
  pip.armF.to(at(5500), 160, { rot: 84 }, { ease: 'ease-out' });
  pip.armB.to(at(5500), 160, { rot: 90 }, { ease: 'ease-out' });
  pip.root.to(at(5500), 200, { rot: fwd(pip, 14) }, { ease: 'ease-out' });
  pip.squash(at(5640), 160, 0.94, 1.04);

  // --- drag him off, face-up, head bumping
  const D0 = 5760;
  const DUR = 1040;
  pip.walk(at(D0), DUR, -260, { stride: 380, amp: 30, bounce: 5, swing: 0 });
  rex.root.to(at(D0), DUR, { x: -212 }, { ease: 'linear', reduce: 'snap' });
  rex.bob.keys(at(D0), DUR, Array.from({ length: 5 }, (_, i) => ({ o: (i + 1) / 5, y: i % 2 ? 0 : -9 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  const trail = [0, 1, 2, 3, 4].map((i) => dust({ x: 790 - i * 190, y: GY + 4, at: at(D0 + i * 200), n: 3, spread: 30, r: 26, dir: 1, seed: 60 + i, dur: 700 })).join('');
  const fx =
    flash({ at: at(IMPACT), dur: 200, peak: 0.95 }) +
    pow({ x: 880, y: 226, at: at(IMPACT + 10), text: 'BONK!', scale: 0.92, rot: -9, dur: 1100 }) +
    rays({ x: 850, y: 372, at: at(IMPACT), r0: 40, r1: 120, n: 14, dur: 380, width: 6 }) +
    sparks({ x: 850, y: 360, at: at(IMPACT), n: 12, power: 150, angle: -Math.PI / 2, spread: Math.PI * 1.6, seed: 17 }) +
    chips({ x: 850, y: 350, at: at(IMPACT), n: 7, power: 120, seed: 23, fill: '#f4f4f4' }) +
    dizzy({ x: 850, y: 322, at: at(IMPACT + 260), dur: 1150, rx: 56, ry: 14 }) +
    dust({ x: 720, y: GY + 6, at: at(IMPACT - 10), n: 4, spread: 40, r: 24, dir: -1, seed: 30, dur: 700 }) +
    drops({ x: 800, y: 410, at: at(IMPACT + 60), n: 3, seed: 8, spread: 90 }) +
    dust({ x: 950, y: GY + 6, at: at(FALL), n: 7, spread: 140, r: 38, dir: 1, seed: 33, dur: 1100 }) +
    pow({ x: 960, y: 470, at: at(FALL + 20), text: 'THUD!', scale: 0.62, rot: 6, font: 60, dur: 700 }) +
    trail;

  return cam.html(`${frontBack(id)}${cactus(150)}${s1.html}${s2.html}${pip.html}${rex.html}${frontFore()}${fx}`);
}
