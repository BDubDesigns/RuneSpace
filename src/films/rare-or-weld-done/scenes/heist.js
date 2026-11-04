/**
 * Beat 2 - The great heist.
 *   wall    : night. The thief sneaks past the ordinary door, dodges the searchlight, sizes up the wall.
 *   arc     : close-up. Goggles down. The torch lights: a blinding arc.
 *   cut     : he cuts a doorway through the wall (cart gag, boot-to-floor weld), the slab drops.
 *   squeeze : he squeezes sideways into the hole.
 *   vault   : inside. He discovers the giant Emerald, far bigger than he expected.
 */
import { prospector } from '../../../art/prospector.js';
import { torch, gasCart, TORCH_TIP } from '../../../art/weld.js';
import { emerald, plinth, stanchion, rope, placard } from '../../../art/emerald.js';
import { placed, INK } from '../../../art/props.js';
import { arc, dust, puff, sparks, mark, pow, rays, drops, flash, sparkle, chips } from '../../../fx/effects.js';
import { Camera, fwd, aimAlong, idle } from '../../../kit.js';
import { tween, show } from '../../../acting.js';
import { museumFront, wallClose, galleryFront, GY, WALL } from '../world.js';
import { TEXT } from '../config.js';

const SC = 0.95;
const FLOOR = 590; // where the wall meets the plaza (the cut's bottom edge)

/** Searchlight + camera + LED life shared by the night exterior shots. */
function nightLife(ctx, { sweep = true } = {}) {
  const { cues, at, id } = ctx;
  if (sweep) {
    cues.push({ at: at(0), dur: 2800, iterations: ctx.dur / 2800, direction: 'alternate', target: `${id}.sweep`, easing: 'ease-in-out', keyframes: [{ transform: 'rotate(128deg)' }, { transform: 'rotate(160deg)' }], reduce: 'skip' });
  }
  cues.push({ at: at(0), dur: 3000, iterations: ctx.dur / 3000, direction: 'alternate', target: `${id}.camHead`, easing: 'ease-in-out', keyframes: [{ transform: 'rotate(-14deg)' }, { transform: 'rotate(22deg)' }], reduce: 'skip' });
  cues.push({ at: at(0), dur: 700, iterations: ctx.dur / 700, direction: 'alternate', target: `${id}.led`, easing: 'steps(1, end)', keyframes: [{ opacity: 1 }, { opacity: 0.15 }], reduce: 'skip' });
}

/* ------------------------------------------------------------------ wall */

export function wall(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 640, y: 380, s: 1.0 });
  cam.look(at(3600), 2400, { x: 700, y: 400, s: 1.22 }, 'ease-in-out');
  nightLife(ctx);
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: -170, y: GY, scale: SC, face: 'normal', goggles: 'up', props: { F: torch(`${id}.tc`) }, armF: -35 });
  thief.propF.set(at(0), { rot: -34 });

  // --- tiptoes in from the left
  thief.walk(at(0), 1250, 120, { stride: 420, amp: 14, bounce: 7, swing: 0 });
  // the ordinary door: he glances at it, scoffs, waves it off
  thief.face(at(1250), 'glance');
  thief.head.to(at(1250), 220, { rot: fwd(thief, 9) });
  cues.push({ at: at(1400), dur: 500, target: `${id}.closed`, easing: 'ease-in-out', keyframes: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(7deg)', offset: 0.3 }, { transform: 'rotate(-5deg)', offset: 0.6 }, { transform: 'rotate(0deg)' }], reduce: 'skip' });
  thief.face(at(1750), 'smug');
  thief.head.to(at(1750), 200, { rot: fwd(thief, -6) });
  thief.armB.keys(at(1750), 280, [{ o: 0.5, rot: -60 }, { o: 1, rot: 0 }], { ease: 'ease-in-out' });
  // --- the searchlight catches him: statue
  thief.face(at(2050), 'shock');
  thief.armB.to(at(2050), 100, { rot: -170 }, { ease: 'ease-out' });
  thief.bob.keys(at(2050), 260, [{ o: 0.4, y: -22 }, { o: 1, y: 0 }], { ease: 'ease-out' });
  thief.vibrate(at(2100), 700, 2.2);
  thief.armB.to(at(2850), 200, { rot: 0 });
  thief.face(at(2850), 'glance');
  thief.face(at(3150), 'smug');
  // --- ducks the camera, then sneaks on to the wall
  thief.bob.keys(at(2900), 380, [{ o: 0.3, sy: 0.82, sx: 1.06 }, { o: 0.7, sy: 0.82, sx: 1.06 }, { o: 1, sy: 1, sx: 1 }], { ease: 'ease-in-out' });
  thief.walk(at(3300), 900, 560, { stride: 400, amp: 14, bounce: 7, swing: 0 });
  // --- studies the wall, very seriously
  thief.face(at(4250), 'normal');
  thief.armB.to(at(4250), 260, { rot: -150 }, { ease: 'ease-out' });
  thief.head.keys(at(4350), 1200, [{ o: 0.25, rot: fwd(thief, 9) }, { o: 0.5, rot: fwd(thief, -9) }, { o: 0.75, rot: fwd(thief, 7) }, { o: 1, rot: fwd(thief, 0) }], { seg: 'ease-in-out', ease: 'linear' });
  thief.face(at(4850), 'glance');
  thief.armF.to(at(5150), 300, { rot: -110 }, { ease: 'ease-out' });
  thief.propF.to(at(5150), 300, { rot: -6 }, { ease: 'ease-out' });
  thief.face(at(5500), 'plot');
  thief.armB.to(at(5500), 240, { rot: 0 });
  show(cues, `${id}.tc.pilot`, at(5700));
  thief.goggles(at(5950), 'down');
  thief.bob.keys(at(5950), 260, [{ o: 0.4, sy: 0.96 }, { o: 1, sy: 1 }], { ease: 'ease-out', reduce: 'skip' });

  const fx =
    dust({ x: 100, y: GY + 4, at: at(1200), n: 3, spread: 30, r: 16, dir: -1, seed: 3, dur: 600 }) +
    mark({ x: 180, y: 360, at: at(1400), text: '?', dur: 900, size: 84 }) +
    mark({ x: 520, y: 300, at: at(2060), dur: 1000, size: 90 }) +
    drops({ x: 560, y: 410, at: at(2150), n: 3, seed: 5, spread: 70 }) +
    sparkle({ x: 692, y: 540, at: at(5750), dur: 700, r: 18, n: 2, s: 1.2 });
  return cam.html(`${museumFront(id)}${thief.html}${fx}`);
}

/* ------------------------------------------------------------------ arc */

export function arcShot(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 640, y: 360, s: 1.0 });
  cam.look(at(0), 1400, { x: 700, y: 370, s: 1.08 }, 'linear');
  cam.shake(at(1500), 1100, 5, 40);
  const flare = arc({ x: 0, y: 0, at: at(1500), dur: 140, n: 8, r: 22 });
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 300, y: 880, scale: 2.5, face: 'smug', goggles: 'up', props: { F: torch(`${id}.tc`, flare) }, armF: -86, hatY: 0 });
  thief.propF.set(at(0), { rot: 80 });
  // tip of the torch in world coordinates (grip + TORCH_TIP, scaled)
  const tipX = 300 + 35 * 2.5 + 60 * 2.5 + TORCH_TIP.x * 2.5 * 0.99;
  const tipY = 880 - 138 * 2.5 + 8 * 2.5 - 20;

  thief.face(at(0), 'smug');
  thief.head.to(at(0), 200, { rot: fwd(thief, -3) });
  thief.goggles(at(650), 'down');
  thief.bob.keys(at(650), 240, [{ o: 0.4, sy: 0.97 }, { o: 1, sy: 1 }], { ease: 'ease-out', reduce: 'skip' });
  thief.face(at(900), 'plot');
  show(cues, `${id}.tc.pilot`, at(1000));
  thief.armF.to(at(1100), 300, { rot: -96 }, { ease: 'ease-out' });
  thief.propF.to(at(1100), 300, { rot: 92 }, { ease: 'ease-out' });
  thief.vibrate(at(1500), 1100, 2.6);

  const fx =
    flash({ at: at(1500), dur: 200, peak: 0.95 }) +
    sparks({ x: tipX + 20, y: tipY, at: at(1500), n: 16, power: 230, angle: -0.25, spread: 2.2, seed: 21, size: 1.3, dur: 760 }) +
    sparks({ x: tipX + 20, y: tipY, at: at(1950), n: 14, power: 190, angle: -0.2, spread: 2.4, seed: 22, size: 1.2, dur: 700 }) +
    sparks({ x: tipX + 20, y: tipY, at: at(2300), n: 12, power: 170, angle: -0.2, spread: 2.4, seed: 23, size: 1.1, dur: 620 }) +
    puff({ x: tipX + 60, y: tipY - 20, at: at(1800), dur: 1300, r: 50, dy: -120, dx: 40, fill: 'url(#g-smoke)' }) +
    puff({ x: tipX + 40, y: tipY - 10, at: at(2150), dur: 1300, r: 44, dy: -110, dx: 20, fill: 'url(#g-smoke)' });
  return `${wallClose(id)}${cam.html(`${thief.html}${fx}`)}`;
}

/* ------------------------------------------------------------------ cut */

const SEGS = [
  { line: [[WALL.cx - WALL.hw, FLOOR], [WALL.cx - WALL.hw, 412]] },
  { quad: [[WALL.cx - WALL.hw, 412], [WALL.cx, 292], [WALL.cx + WALL.hw, 412]] },
  { line: [[WALL.cx + WALL.hw, 412], [WALL.cx + WALL.hw, FLOOR]] },
];
const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
const segPoint = (g, u) => {
  if (g.line) return lerp(g.line[0], g.line[1], u);
  const [a, c, b] = g.quad;
  const p = lerp(a, c, u);
  const q = lerp(c, b, u);
  return lerp(p, q, u);
};
const segLen = (g) => {
  let l = 0;
  let prev = segPoint(g, 0);
  for (let i = 1; i <= 24; i++) {
    const p = segPoint(g, i / 24);
    l += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return l;
};
const LENS = SEGS.map(segLen);
const TOTAL = LENS.reduce((a, b) => a + b, 0);
/** s in 0..1 along the whole cut -> {x, y} */
function cutAt(s) {
  let d = s * TOTAL;
  for (let i = 0; i < SEGS.length; i++) {
    if (d <= LENS[i] || i === SEGS.length - 1) {
      const p = segPoint(SEGS[i], Math.min(1, d / LENS[i]));
      return { x: p[0], y: p[1] };
    }
    d -= LENS[i];
  }
  return { x: 0, y: 0 };
}
const archPath = (g) => (g.line ? `M${g.line[0]} L${g.line[1]}` : `M${g.quad[0]} Q${g.quad[1]} ${g.quad[2]}`);

export function cut(ctx) {
  const { cues, at, id } = ctx;
  const T0 = 300;
  const D = 4400;
  const END = T0 + D; // the last edge is cut
  const NOTICE = END + 800; // he sees what the torch did to his boot
  const STRAIN = NOTICE + 350;
  const TWANG = STRAIN + 500;
  const FREE = TWANG + 700;
  const PUSH = FREE + 800;
  const FALL = PUSH + 360;
  const BUMP = 4100;
  const cam = new Camera(cues, id, { x: 700, y: 470, s: 1.28 });
  cam.look(at(1800), 2300, { x: 770, y: 460, s: 1.3 }, 'ease-in-out');

  const flareCut = arc({ x: 0, y: 0, at: at(T0), dur: 130, n: Math.round(D / 130), r: 30 });
  const flareBoot = arc({ x: 0, y: 0, at: at(END + 350), dur: 130, n: 4, r: 28 });
  const flareFree = arc({ x: 0, y: 0, at: at(FREE + 120), dur: 130, n: 5, r: 28 });
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 520, y: GY, scale: SC, face: 'plot', goggles: 'down', props: { F: torch(`${id}.tc`, flareCut + flareBoot + flareFree) }, armF: -80 });
  thief.propF.set(at(0), { rot: -8 });
  const tank = placed(cues, `${id}.cart`, `<g transform="scale(.9)">${gasCart(`${id}.gc`)}</g>`, { x: 300, y: GY });
  const slab = placed(
    cues,
    `${id}.slab`,
    `<path d="M-101 0 L-101 -178 Q0 -306 101 -178 L101 0Z" fill="#5a5a5a" stroke="${INK}" stroke-width="3"/><path d="M-101 0 L-101 -178 Q0 -306 101 -178 L101 0Z" fill="url(#p-hatch)"/>
     <rect x="-101" y="-16" width="202" height="16" fill="url(#p-hazard)" stroke="${INK}" stroke-width="3"/>
     ${[-70, -20, 30, 80].map((x) => `<circle cx="${x}" cy="-150" r="4.6" fill="#d0d0d0" stroke="${INK}" stroke-width="2"/>`).join('')}<circle cx="0" cy="-232" r="4.6" fill="#d0d0d0" stroke="${INK}" stroke-width="2"/>`,
    { x: WALL.cx, y: FLOOR }
  );

  // --- the cut: the tip follows the path, the kerf draws itself on
  const standX = (s) => (s < 0.3 ? 520 + (s / 0.3) * 60 : s < 0.65 ? 580 + ((s - 0.3) / 0.35) * 130 : 710 + ((s - 0.65) / 0.35) * 66);
  const tips = aimAlong(thief, at(T0), D, cutAt, { toolLen: TORCH_TIP.x, stand: standX, step: 110, prefer: -2 });
  thief.walk(at(T0), D, standX(1), { noRoot: true, stride: 700, amp: 9, swing: 0, bounce: 3 });
  thief.face(at(2300), 'angry'); // grits his teeth for the overhead run
  thief.face(at(3700), 'plot');
  thief.head.keys(at(T0), D, Array.from({ length: 12 }, (_, i) => ({ o: (i + 1) / 12, rot: fwd(thief, i % 2 ? 4 : -2) })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  // kerf + glowing core, drawn on segment by segment
  let acc = 0;
  let line = '';
  SEGS.forEach((g, i) => {
    const t = at(T0 + (acc / TOTAL) * D);
    const dur = (LENS[i] / TOTAL) * D;
    acc += LENS[i];
    line += `<path d="${archPath(g)}" pathLength="1" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round" stroke-dasharray="1 1" style="stroke-dashoffset:1" data-t="${id}.k${i}"/>
      <path d="${archPath(g)}" pathLength="1" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-dasharray="1 1" style="stroke-dashoffset:1" data-t="${id}.c${i}"/>`;
    [`${id}.k${i}`, `${id}.c${i}`].forEach((tg) => cues.push({ at: t, dur, target: tg, easing: 'linear', keyframes: [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }] }));
    cues.push({ at: t + dur + 200, dur: 900, target: `${id}.c${i}`, easing: 'linear', keyframes: [{ opacity: 1 }, { opacity: 0.18 }] });
  });

  // --- the gas cart follows by its hose and finally bumps him
  const wheelDeg = (dx) => (dx / (28 * 0.9)) * 57.3;
  tank.track.to(at(1600), 1000, { x: 460 }, { ease: 'ease-in-out', reduce: 'snap' });
  cues.push({ at: at(1600), dur: 1000, target: `${id}.gc.wheel`, easing: 'ease-in-out', keyframes: [{ transform: 'rotate(0deg)' }, { transform: `rotate(${wheelDeg(160)}deg)` }], reduce: 'skip' });
  tank.track.to(at(3200), BUMP - 3200, { x: 650 }, { ease: 'cubic-bezier(.4,0,1,1)', reduce: 'snap' });
  cues.push({ at: at(3200), dur: BUMP - 3200, target: `${id}.gc.wheel`, easing: 'cubic-bezier(.4,0,1,1)', keyframes: [{ transform: `rotate(${wheelDeg(160)}deg)` }, { transform: `rotate(${wheelDeg(350)}deg)` }], reduce: 'skip' });
  tank.track.keys(at(BUMP), 420, [{ o: 0.3, x: 638, rot: -4 }, { o: 0.6, x: 650, rot: 2 }, { o: 1, x: 646, rot: 0 }], { ease: 'ease-out', reduce: 'skip' });
  thief.torso.keys(at(BUMP), 320, [{ o: 0.35, y: -18, rot: fwd(thief, 8) }, { o: 1, y: 0, rot: 0 }], { ease: 'ease-out' });
  cam.shake(at(BUMP), 400, 7);

  // --- the BOOT: the torch drifts down onto his own boot and welds it to the plaza
  const BOOT = { x: 776 + 34, y: GY - 4 };
  const dr = aimAlong(thief, at(END), 360, (s) => ({ x: 856 + (BOOT.x - 856) * s, y: FLOOR + (BOOT.y - FLOOR) * s }), { toolLen: TORCH_TIP.x, stand: () => 776, step: 90, prefer: 30, lead: 0 });
  const bootSeam = `<g data-t="${id}.seam" style="opacity:0"><ellipse cx="${BOOT.x}" cy="${GY + 2}" rx="52" ry="12" fill="#fff" stroke="${INK}" stroke-width="4"/><ellipse cx="${BOOT.x}" cy="${GY + 2}" rx="30" ry="6" fill="#bbb"/></g>`;
  cues.push({ at: at(END + 380), dur: 200, target: `${id}.seam`, easing: 'linear', keyframes: [{ opacity: 0 }, { opacity: 1 }] });
  cues.push({ at: at(END + 1200), dur: 700, target: `${id}.seam`, easing: 'linear', keyframes: [{ opacity: 1 }, { opacity: 0.55 }] });
  // he notices: goggles up, shock
  thief.armF.to(at(NOTICE - 100), 200, { rot: -50 }, { ease: 'ease-out' });
  thief.propF.to(at(NOTICE - 100), 200, { rot: 25 }, { ease: 'ease-out' });
  thief.goggles(at(NOTICE), 'up');
  thief.face(at(NOTICE), 'shock');
  thief.head.to(at(NOTICE), 160, { rot: fwd(thief, 16) });
  thief.bob.hop(at(NOTICE), 260, 10);
  // tries to step away: stuck foot, rubber-band lean, TWANG back
  thief.face(at(STRAIN), 'angry');
  thief.root.to(at(STRAIN), 480, { rot: fwd(thief, -26) }, { ease: 'ease-out', reduce: 'snap' }); // leaning away from the wall, pinned by the boot
  thief.legB.to(at(STRAIN), 480, { rot: fwd(thief, -40) }, { ease: 'ease-out' });
  thief.armF.to(at(STRAIN), 480, { rot: 40 }, { ease: 'ease-out' });
  thief.armB.to(at(STRAIN), 480, { rot: 40 }, { ease: 'ease-out' });
  thief.vibrate(at(STRAIN + 150), 350, 3.5);
  thief.root.keys(at(TWANG), 680, [{ o: 0.16, rot: fwd(thief, 18) }, { o: 0.38, rot: fwd(thief, -9) }, { o: 0.62, rot: fwd(thief, 5) }, { o: 0.82, rot: fwd(thief, -2) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'snap' });
  thief.legB.to(at(TWANG), 150, { rot: 0 });
  thief.armF.to(at(TWANG), 300, { rot: -30 });
  thief.armB.to(at(TWANG), 300, { rot: 0 });
  thief.face(at(TWANG + 100), 'shock');
  // --- free the boot with a short burst of the arc
  thief.face(at(FREE), 'sad');
  thief.goggles(at(FREE), 'down');
  thief.armF.to(at(FREE), 220, { rot: -20 }, { ease: 'ease-out' });
  thief.propF.to(at(FREE), 220, { rot: 62 }, { ease: 'ease-out' });
  thief.root.to(at(FREE), 220, { rot: fwd(thief, 16) }, { ease: 'ease-out', reduce: 'snap' });
  cues.push({ at: at(FREE + 700), dur: 300, target: `${id}.seam`, easing: 'linear', keyframes: [{ opacity: 0.55 }, { opacity: 0 }] });

  // --- the slab: a tap, a tilt, CLANG
  thief.root.to(at(FREE + 600), 260, { rot: 0 }, { ease: 'ease-in-out', reduce: 'snap' });
  thief.face(at(FREE + 600), 'plot');
  thief.armF.to(at(FREE + 600), 260, { rot: -104 }, { ease: 'ease-out' });
  thief.propF.to(at(FREE + 600), 260, { rot: -2 }, { ease: 'ease-out' });
  show(cues, `${id}.tc.pilot`, at(FREE + 1), false);
  slab.track.keys(at(PUSH - 400), 380, [{ o: 0.5, rot: 0.6 }, { o: 1, rot: -0.4 }], { ease: 'ease-in-out', reduce: 'skip' });
  slab.track.keys(at(PUSH), 380, [{ o: 1, sy: 0.14, sx: 0.98 }], { ease: 'cubic-bezier(.5,0,.9,.5)', reduce: 'snap' });
  cam.shake(at(FALL), 500, 12);

  // --- effects on the cut line: sparks and smoke follow the tip
  let fx = '';
  tips.forEach((p, i) => {
    if (i % 3 === 0) {
      fx += sparks({ x: p.x, y: p.y, at: p.t, n: 8, power: 120, angle: -1.2, spread: 3.2, seed: 40 + i, size: 0.95, dur: 560 });
    }
    if (i % 6 === 0) fx += puff({ x: p.x + 8, y: p.y - 10, at: p.t, dur: 1500, r: 28, dy: -100, dx: 14, fill: 'url(#g-smoke)' });
  });
  dr.forEach((p, i) => {
    if (i % 2 === 0) fx += sparks({ x: p.x, y: p.y, at: p.t + 380, n: 7, power: 80, angle: -1.57, spread: 2.6, seed: 90 + i, size: 0.85, dur: 520 });
  });
  fx += puff({ x: BOOT.x, y: BOOT.y - 10, at: at(END + 500), dur: 1500, r: 34, dy: -110, fill: 'url(#g-smoke)' });
  fx += puff({ x: BOOT.x, y: BOOT.y - 10, at: at(END + 900), dur: 1500, r: 30, dy: -120, dx: -20, fill: 'url(#g-smoke)' });
  fx += mark({ x: 780, y: 330, at: at(NOTICE), dur: 1000, size: 92 });
  fx += drops({ x: 800, y: 380, at: at(NOTICE + 120), n: 3, seed: 8, spread: 70 });
  fx += pow({ x: 640, y: 380, at: at(BUMP + 10), text: 'CLANG!', scale: 0.46, rot: -8, font: 58, dur: 600 });
  fx += pow({ x: 790, y: 640, at: at(TWANG + 20), text: 'TWANG!', scale: 0.46, rot: 7, font: 56, dur: 700 });
  fx += sparks({ x: BOOT.x, y: BOOT.y, at: at(FREE + 150), n: 12, power: 100, angle: -1.57, spread: 2.8, seed: 77, size: 1, dur: 600 });
  fx += puff({ x: BOOT.x, y: BOOT.y - 10, at: at(FREE + 300), dur: 1400, r: 30, dy: -90, fill: 'url(#g-smoke)' });
  fx += pow({ x: WALL.cx + 20, y: 300, at: at(FALL + 20), text: 'CLANG!', scale: 0.66, rot: -7, dur: 1200 });
  fx += dust({ x: WALL.cx, y: FLOOR + 4, at: at(FALL), n: 9, spread: 150, r: 42, dir: 0, seed: 12, dur: 1500 });
  fx += rays({ x: WALL.cx, y: FLOOR - 20, at: at(FALL), r0: 40, r1: 110, n: 12, dur: 400, width: 6 });
  fx += chips({ x: WALL.cx, y: FLOOR - 10, at: at(FALL), n: 8, power: 150, seed: 5, fill: '#bbb' });

  return `${cam.html(`${museumFront(id, { hole: true })}${slab.html}<g>${line}</g>${tank.html}${bootSeam}${thief.html}${fx}`)}${flash({ at: at(FALL), dur: 160, peak: 0.45 })}`;
}

/* ------------------------------------------------------------------ squeeze */

export function squeeze(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 770, y: 460, s: 1.3 });
  cam.look(at(200), 2800, { x: 760, y: 470, s: 1.45 }, 'ease-in-out');
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 600, y: GY, scale: SC, face: 'smug', goggles: 'up', props: { F: torch(`${id}.tc`) }, armF: -20 });
  thief.propF.set(at(0), { rot: 30 });
  const dark = placed(cues, `${id}.dark`, `<path d="M-96 0 L-96 -178 Q0 -304 96 -178 L96 0Z" fill="#000"/>`, { x: WALL.cx, y: FLOOR });
  tween(cues, `${id}.dark`, at(0), 1, { opacity: 0 }, { opacity: 0 });

  // sizes up the hole, sucks in his gut, turns sideways
  thief.face(at(0), 'glance');
  thief.head.to(at(0), 200, { rot: fwd(thief, 6) });
  thief.walk(at(150), 550, 662, { stride: 330, amp: 14, bounce: 5, swing: 5 });
  thief.face(at(750), 'plot');
  thief.bob.to(at(800), 260, { sx: 1.1, sy: 0.96 }, { ease: 'ease-out' });
  thief.bob.to(at(1060), 200, { sx: 0.96, sy: 1.0 });
  thief.root.to(at(1100), 280, { sx: 0.55 * SC }, { ease: 'ease-in-out', reduce: 'snap' });
  // shuffles in, gets stuck, wiggles, pops through
  thief.walk(at(1450), 550, 724, { stride: 240, amp: 24, bounce: 4, swing: 0, ease: 'ease-in' });
  thief.face(at(2000), 'angry');
  thief.walk(at(2000), 650, 724, { noRoot: true, stride: 100, amp: 40, bounce: 8, swing: 0 });
  thief.vibrate(at(2000), 650, 3.4);
  thief.root.keys(at(2000), 650, [{ o: 0.3, x: 730 }, { o: 0.5, x: 720 }, { o: 0.75, x: 734 }, { o: 1, x: 724 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'snap' });
  thief.root.to(at(2650), 520, { x: 770, sx: 0.5 * SC, sy: 0.9 * SC }, { ease: 'cubic-bezier(.2,.8,.3,1)', reduce: 'snap' });
  tween(cues, `${id}.dark`, at(2600), 520, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
  thief.face(at(2650), 'shock');

  const fx =
    drops({ x: 700, y: 400, at: at(2100), n: 4, seed: 9, spread: 80 }) +
    pow({ x: 680, y: 380, at: at(2640), text: 'POP!', scale: 0.5, rot: -8, font: 60, dur: 700 }) +
    puff({ x: 700, y: FLOOR - 6, at: at(2650), dur: 1000, r: 36, dy: -50, dx: -30 }) +
    puff({ x: 740, y: FLOOR - 6, at: at(2730), dur: 1000, r: 32, dy: -40, dx: 30 }) +
    dust({ x: 700, y: GY + 4, at: at(1500), n: 3, spread: 30, r: 16, dir: -1, seed: 8, dur: 500 });
  return cam.html(`${museumFront(id, { hole: true })}${thief.html}${dark.html}${fx}`);
}

/* ------------------------------------------------------------------ vault */

export function vault(ctx) {
  const { cues, at, id } = ctx;
  const FLOORV = 640;
  const cam = new Camera(cues, id, { x: -60, y: 400, s: 1.0 });
  cam.look(at(300), 2500, { x: 330, y: 400, s: 1.0 }, 'ease-in-out');
  cam.look(at(3000), 1300, { x: 600, y: 360, s: 1.0 }, 'ease-in-out');
  cam.look(at(4700), 1450, { x: 700, y: 340, s: 0.9 }, 'ease-in-out');
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: -120, y: FLOORV, scale: SC, face: 'glance', goggles: 'up', props: { F: torch(`${id}.tc`) }, armF: -20 });
  thief.propF.set(at(0), { rot: 30 });
  const gem = placed(cues, `${id}.gem`, `<g transform="scale(1.4)">${emerald(`${id}.em`, { w: 300, h: 360 })}</g>`, { x: 860, y: 560 });

  // steps in cautiously, scanning; the glow draws him on
  thief.walk(at(300), 1900, 330, { stride: 440, amp: 16, bounce: 6, swing: 5 });
  thief.head.keys(at(300), 1800, [{ o: 0.25, rot: fwd(thief, 8) }, { o: 0.5, rot: fwd(thief, -8) }, { o: 0.75, rot: fwd(thief, 6) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  // he sees it
  thief.face(at(2300), 'normal');
  thief.face(at(2800), 'greed');
  thief.bob.hop(at(2700), 260, 12);
  thief.walk(at(3000), 700, 430, { stride: 260, amp: 18, bounce: 5, swing: 4 });
  // the jaw-drop: the hat springs up and the eyes bug out
  const REVEAL = 4300;
  thief.face(at(REVEAL), 'shock');
  thief.head.to(at(REVEAL), 160, { rot: fwd(thief, -14) }, { ease: 'ease-out' });
  thief.bob.keys(at(REVEAL), 380, [{ o: 0.35, y: -36, sy: 1.08, sx: 0.95 }, { o: 1, y: 0, sy: 1, sx: 1 }], { ease: 'ease-out' });
  thief.hat.keys(at(REVEAL), 700, [{ o: 0.3, y: -52, rot: fwd(thief, 12) }, { o: 0.65, y: 4, rot: fwd(thief, -4) }, { o: 1, y: 0, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'snap' });
  thief.armF.to(at(REVEAL), 200, { rot: -20 });
  thief.head.to(at(REVEAL + 500), 1100, { rot: fwd(thief, -24) }, { ease: 'ease-in-out' }); // looks up... and up

  const stan = (x, y) => `<g transform="translate(${x} ${y})">${stanchion()}</g>`;
  const fx =
    sparkle({ x: 740, y: 190, at: at(1200), dur: 1000, r: 36, n: 4, s: 1.3 }) +
    sparkle({ x: 1000, y: 250, at: at(1800), dur: 1000, r: 30, n: 4, s: 1.3 }) +
    sparkle({ x: 880, y: 350, at: at(2400), dur: 1000, r: 40, n: 4, s: 1.4 }) +
    sparkle({ x: 780, y: 440, at: at(3000), dur: 1000, r: 28, n: 3, s: 1.2 }) +
    sparkle({ x: 960, y: 140, at: at(3500), dur: 1000, r: 34, n: 4, s: 1.3 }) +
    mark({ x: 470, y: 250, at: at(REVEAL), dur: 1300, size: 100 }) +
    drops({ x: 470, y: 330, at: at(REVEAL + 100), n: 4, seed: 4, spread: 90 });
  const gal = galleryFront(id);
  const base = `<g transform="translate(860 560)">${plinth(480, 130)}</g>`;
  const ropes = `${stan(520, 700)}${stan(1200, 700)}<g transform="translate(520 700)">${rope(680)}</g>`;
  const plac = `<g transform="translate(860 720)">${placard(TEXT.placard)}</g>`;
  return cam.html(`${gal}${base}${gem.html}${ropes}${plac}${thief.html}${fx}`);
}
