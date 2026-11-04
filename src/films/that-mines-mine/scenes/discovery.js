/**
 * Beat 1 - The discovery.
 *   trudge  : wide. A scruffy prospector trudges in, spots the glittering mine, does a double take.
 *   glitter : POV push-in on the sparkling mine mouth.
 *   stake   : he trips, belly-flops, hammers in a stake and plants the MINE! sign.
 */
import { prospector } from '../../../art/prospector.js';
import { cutter, mallet, sign, boulder, placed } from '../../../art/props.js';
import { dust, sparks, sparkle, mark, pow, drops, rays, speedLines, puff } from '../../../fx/effects.js';
import { tween } from '../../../acting.js';
import { Camera, driftClouds } from '../kit.js';
import { frontBack, frontFore, cactus, WORLD_DEFS } from '../world.js';
import { TEXT } from '../config.js';

const GY = 604;

const MINE_GLINTS = [
  [806, 470, 24], [908, 506, 28], [838, 548, 22], [888, 432, 20], [926, 560, 22], [866, 490, 16], [830, 440, 16],
];

export function glints(ctx, startRel, scale = 1) {
  return MINE_GLINTS.map(([x, y, r], i) =>
    sparkle({ x, y, at: ctx.at(startRel + i * 170), dur: 1000, r: r * scale, n: Math.ceil((ctx.dur - startRel - i * 170) / 1000) + 1 })
  ).join('');
}

export function trudge(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: -160, y: GY, scale: 0.92, pack: true, props: { F: cutter(`${id}.cut`) }, armF: -14 });
  driftClouds(ctx, id);

  pip.head.set(at(0), { rot: 7 }); // chin on chest: long walk
  pip.walk(at(150), 2350, 440, { stride: 660, amp: 20, bounce: 5, swing: 9 });

  // skid to a halt
  pip.root.to(at(2500), 300, { x: 478 }, { ease: 'cubic-bezier(.1,.7,.3,1)' });
  pip.legF.to(at(2500), 140, { rot: 32 }, { ease: 'ease-out' });
  pip.legB.to(at(2500), 140, { rot: -26 }, { ease: 'ease-out' });
  pip.rest(at(2780), 200);
  pip.squash(at(2500), 260, 0.9, 1.08);

  // look ... look away ... DOUBLE TAKE
  pip.face(at(2750), 'glance');
  pip.head.to(at(2750), 200, { rot: -6 }, { ease: 'ease-out' });
  pip.head.to(at(3050), 220, { rot: 5 });
  pip.face(at(3050), 'normal');
  pip.face(at(3500), 'shock');
  pip.head.keys(at(3500), 150, [{ o: 1, rot: -16 }], { ease: 'cubic-bezier(.2,1.6,.4,1)' });
  pip.bob.hop(at(3500), 320, 46);
  pip.armF.to(at(3500), 160, { rot: -138 }, { ease: 'cubic-bezier(.2,1.5,.4,1)' });
  pip.armB.to(at(3500), 160, { rot: 62 }, { ease: 'cubic-bezier(.2,1.5,.4,1)' });
  pip.vibrate(at(3820), 520, 2.4);
  pip.face(at(4140), 'greed');

  // ...and stays right there, rooted to the spot, quivering at the glitter. (No running into the mine.)
  pip.vibrate(at(4140), 460, 2.6);

  cam.look(at(3300), 520, { x: 500, y: 430, s: 1.28 });
  cam.look(at(4140), 460, { x: 496, y: 428, s: 1.4 }, 'ease-in-out');

  const fx =
    glints(ctx, 2200) +
    dust({ x: 420, y: GY + 8, at: at(2500), n: 5, spread: 40, r: 26, dir: -1, seed: 4 }) +
    mark({ x: 520, y: 330, at: at(3500), dur: 1100, size: 100 }) +
    drops({ x: 492, y: 362, at: at(3560), n: 3, seed: 3 }) +
    drops({ x: 492, y: 362, at: at(4200), n: 2, seed: 8 });

  return cam.html(`${frontBack(id)}${cactus(150)}${pip.html}${frontFore()}${fx}`);
}

export function glitter(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 860, y: 450, s: 1.4 });
  cam.look(at(0), ctx.dur, { x: 860, y: 486, s: 3.1 }, 'cubic-bezier(.4,0,.6,1)');
  tween(cues, `${id}.glow`, at(0), ctx.dur, { opacity: 0.2 }, { opacity: 0.95 }, { reduce: 'snap' });
  const g = glints(ctx, 0, 2.1);
  return cam.html(
    `${frontBack(id)}<ellipse data-t="${id}.glow" cx="860" cy="490" rx="130" ry="110" fill="url(#g-glow)" style="opacity:.2"/>${g}`
  );
}

export function stake(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const pip = prospector(cues, `${id}.pip`, {
    kind: 'pip', x: 90, y: GY, scale: 0.92, pack: true, face: 'greed',
    props: { F: mallet(), B: cutter(`${id}.cut`) }, armF: -28,
  });
  const claim = placed(cues, `${id}.sign`, sign('pip', TEXT.sign), { x: 700, y: 540, sx: 0, sy: 0 });
  driftClouds(ctx, id);

  // run, trip on the rock, belly-flop
  pip.walk(at(0), 800, 400, { stride: 250, amp: 42, bounce: 8, swing: 30 });
  pip.root.keys(at(800), 600, [
    { o: 0.5, x: 455, y: 520, rot: 52, ease: 'cubic-bezier(.2,.7,.4,1)' },
    { o: 1, x: 520, y: 560, rot: 86, ease: 'cubic-bezier(.6,0,.9,.5)' },
  ], { ease: 'linear' });
  pip.legF.to(at(800), 180, { rot: 60 }, { ease: 'ease-out' });
  pip.legB.to(at(800), 180, { rot: 25 }, { ease: 'ease-out' });
  pip.armF.to(at(800), 300, { rot: -150 });
  pip.armB.to(at(800), 300, { rot: 150 });
  pip.face(at(840), 'shock');
  cam.shake(at(1400), 320, 9);
  pip.root.keys(at(1400), 380, [{ o: 0.4, y: 540 }, { o: 1, y: 560 }], { ease: 'ease-out' });
  pip.head.to(at(1500), 200, { rot: 14 });
  pip.face(at(1500), 'normal');

  // lift head, spot the gems, spring up
  pip.head.to(at(1950), 260, { rot: -42 }, { ease: 'ease-out' });
  pip.face(at(2000), 'greed');
  pip.root.keys(at(2500), 560, [
    { o: 0.45, y: GY - 14, rot: -14, ease: 'cubic-bezier(.2,.8,.4,1)' },
    { o: 1, y: GY, rot: 0, ease: 'cubic-bezier(.4,0,.5,1.3)' },
  ], { ease: 'linear' });
  pip.legF.to(at(2500), 200, { rot: 0 });
  pip.legB.to(at(2500), 200, { rot: 0 });
  pip.armF.to(at(2500), 260, { rot: -30 });
  pip.armB.to(at(2500), 260, { rot: 0 });
  pip.head.to(at(2500), 300, { rot: 0 });

  // pull the sign out of the pack: POOF
  pip.face(at(3000), 'plot');
  pip.armB.keys(at(3000), 300, [{ o: 1, rot: 128, ease: 'ease-out' }]);
  claim.track.keys(at(3250), 320, [{ o: 0.6, sx: 1.12, sy: 1.12, ease: 'ease-out' }, { o: 1, sx: 1, sy: 1 }], { ease: 'linear' });
  pip.armB.to(at(3300), 280, { rot: 0 });

  pip.walk(at(3300), 220, 568, { stride: 300, amp: 20, bounce: 3, swing: 0 });
  // three blows with the mallet drive the stake in
  const blows = [
    { t: 3550, sink: 576 },
    { t: 3980, sink: 594 },
    { t: 4380, sink: 606 },
  ];
  blows.forEach(({ t, sink }, i) => {
    pip.armF.to(at(t), 230, { rot: -162 }, { ease: 'ease-out' });
    pip.root.to(at(t), 230, { rot: -6 }, { ease: 'ease-out' });
    pip.armF.to(at(t + 230), 90, { rot: -20 }, { ease: 'cubic-bezier(.6,0,1,.6)' });
    pip.root.to(at(t + 230), 90, { rot: 6 }, { ease: 'ease-in' });
    claim.track.to(at(t + 320), 90, { y: sink }, { ease: 'ease-out' });
    pip.squash(at(t + 320), 200, 0.94, 1.05);
  });
  // settle + wobble
  pip.root.to(at(4800), 180, { rot: 0 });
  pip.armF.to(at(4800), 260, { rot: -30 });
  pip.face(at(4800), 'smug');
  claim.track.keys(at(4700), 700, [
    { o: 0.2, rot: 9 }, { o: 0.45, rot: -6 }, { o: 0.7, rot: 3 }, { o: 1, rot: 0 },
  ], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  pip.hat.keys(at(4800), 500, [{ o: 0.3, y: -10, rot: -6 }, { o: 1, y: 0, rot: 0 }], { seg: 'ease-out', ease: 'linear', reduce: 'skip' });

  const rock = `<g transform="translate(430 ${GY + 2})">${boulder(70, 44)}</g>`;
  const fx =
    dust({ x: 520, y: GY + 6, at: at(1400), n: 7, spread: 90, r: 34, dir: 1, seed: 11, dur: 1100 }) +
    pow({ x: 600, y: 470, at: at(1420), text: 'FLOP!', scale: 0.5, rot: 6, dur: 900 }) +
    sparks({ x: 700, y: 480, at: at(3300), n: 10, power: 90, angle: -Math.PI / 2, spread: Math.PI * 2, seed: 7 }) +
    puff({ x: 700, y: 480, at: at(3260), dur: 500, r: 40, dy: -20 }) +
    blows.map((b, i) =>
      rays({ x: 710, y: b.sink - 10, at: at(b.t + 320), r0: 18, r1: 46, n: 8, dur: 300, width: 5 }) +
      dust({ x: 710, y: b.sink + 4, at: at(b.t + 320), n: 3, spread: 30, r: 16, seed: 20 + i, dur: 600 }) +
      pow({ x: 760, y: 430, at: at(b.t + 330), text: ['THUD', 'THUD!', 'THWACK!'][i], scale: 0.4 + i * 0.1, rot: [-8, 7, -5][i], font: 58, dur: 520 })
    ).join('') +
    sparkle({ x: 700, y: 440, at: at(4900), dur: 600, r: 30, n: 1 }) +
    glintsSoft(ctx, 4200);

  return cam.html(`${frontBack(id)}${cactus(150)}${rock}${claim.html}${pip.html}${frontFore()}${fx}`);
}

function glintsSoft(ctx, startRel) {
  return [[806, 470, 22], [908, 506, 24], [866, 440, 16]]
    .map(([x, y, r], i) => sparkle({ x, y, at: ctx.at(startRel + i * 260), dur: 1000, r, n: Math.ceil((ctx.dur - startRel) / 1000) + 1 }))
    .join('');
}

export { WORLD_DEFS };
