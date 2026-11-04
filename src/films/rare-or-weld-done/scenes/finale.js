/**
 * Beats 5-8 - from despair to the perfect crime.
 *   despair                      he sits beside the Emerald, looks at the road to the fence, at the Emerald, at his torch: a lightbulb
 *   posts, iron, gate, signUp, ready   the welding montage: posts, ironwork, gate + booth, the admission sign, the finished attraction
 *   queue                        morning: a long line of tourists, the pile of Credits grows
 *   reread, plate                he rereads "ONE WEEK ONLY!", then welds a plate over the sign: OPEN DAILY
 */
import { prospector } from '../../../art/prospector.js';
import { torch, gasCart, booth, signboard, plate, scroll, scrollPoint, TORCH_TIP } from '../../../art/weld.js';
import { newspaper, creditPile, coin } from '../../../art/heist.js';
import { tourist } from '../../../art/crowd.js';
import { placed, INK } from '../../../art/props.js';
import { arc, dust, puff, sparks, mark, pow, rays, drops, flash, sparkle, lightbulb, chips } from '../../../fx/effects.js';
import { Camera, fwd, aimAlong, idle } from '../../../kit.js';
import { Track, show, tween } from '../../../acting.js';
import { distantRoad, craterBack, craterFront, daySky, GY, YARD } from '../world.js';
import { emerald } from '../../../art/emerald.js';
import { TEXT, NAMES } from '../config.js';
import { yard } from './yard.js';

const SC = 0.95;
const FY = GY + 108; // the thief's ground line in the foreground of the yard

const spark = (p, t, o = {}) => sparks({ x: p.x, y: p.y, at: t, n: o.n ?? 9, power: o.power ?? 130, angle: o.angle ?? -1.57, spread: o.spread ?? 2.8, seed: o.seed ?? 1, size: o.size ?? 1, dur: o.dur ?? 540 });
const smoke = (p, t, o = {}) => puff({ x: p.x, y: p.y, at: t, dur: o.dur ?? 1400, r: o.r ?? 28, dy: o.dy ?? -100, dx: o.dx ?? 12, fill: 'url(#g-smoke)' });

/** One arc window per entry [startMs, endMs] (scene-relative), as markup for the torch tip. */
const flares = (at, windows, r = 30) => windows.map(([a, b]) => arc({ x: 0, y: 0, at: at(a), dur: 130, n: Math.max(1, Math.round((b - a) / 130)), r })).join('');

/* ------------------------------------------------------------------ despair */

export function despair(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 640, y: 380, s: 1.0 });
  const EX = 330;
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 800, y: GY, scale: SC, face: 'sad', goggles: 'up', armF: -146, armB: -150, legF: -90, legB: -82 });
  thief.bob.set(at(0), { y: 60 }); // sits on the ground: the hips drop to the floor
  const tc = placed(cues, `${id}.torch`, `<g transform="scale(.9)">${torch(`${id}.tc`)}</g>`, { x: 930, y: GY + 18, rot: -3 });
  const cart = placed(cues, `${id}.cart`, `<g transform="scale(.9)">${gasCart(`${id}.gc`)}</g>`, { x: 1060, y: GY + 6 });
  const cr = { x: EX, y: GY + 6, rx: 250, ry: 44 };
  const gem = `<g transform="translate(${EX} ${GY + 34}) rotate(4) scale(1.4)">${emerald(`${id}.em`, { w: 300, h: 360 })}</g>`;

  // --- slumped in despair
  thief.head.to(at(0), 500, { rot: fwd(thief, 26) }, { ease: 'ease-in-out' });
  thief.torso.keys(at(300), 900, [{ o: 0.5, y: 5, rot: fwd(thief, 3) }, { o: 1, y: 0, rot: 0 }], { ease: 'ease-in-out', reduce: 'skip' });
  // --- looks up and out along the road: the far, dim sign says FENCE
  thief.head.to(at(1000), 300, { rot: 0 });
  thief.face(at(1000), 'glance');
  thief.armF.to(at(1000), 300, { rot: -28 });
  thief.armB.to(at(1000), 300, { rot: -24 });
  cam.look(at(1300), 900, { x: 1060, y: 330, s: 2.1 }, 'ease-in-out');
  cam.look(at(3000), 700, { x: 640, y: 380, s: 1.0 }, 'ease-in-out');
  // --- looks at his Emerald
  thief.face(at(3300), 'normal');
  cam.look(at(3700), 700, { x: 420, y: 420, s: 1.4 }, 'ease-in-out');
  // --- and then at his welding equipment
  thief.face(at(4400), 'glance');
  thief.head.to(at(4400), 300, { rot: fwd(thief, 20) });
  cam.look(at(4400), 700, { x: 900, y: 520, s: 1.7 }, 'ease-in-out');
  // --- a lightbulb
  thief.head.to(at(5200), 220, { rot: 0 });
  thief.face(at(5200), 'plot');
  thief.torso.keys(at(5200), 700, [{ o: 0.5, y: -6 }, { o: 1, y: 0 }], { ease: 'ease-out', reduce: 'skip' });
  cam.look(at(5100), 700, { x: 790, y: 420, s: 1.25 }, 'ease-in-out');
  cues.push({ at: at(0), dur: 160, iterations: ctx.dur / 160, target: `${id}.neon`, easing: 'steps(1, end)', keyframes: [{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0.55, offset: 0.56 }, { opacity: 1 }], reduce: 'skip' });

  const fx =
    puff({ x: 830, y: GY - 190, at: at(600), dur: 1100, r: 30, dy: -40, dx: 30, opacity: 0.8 }) +
    sparkle({ x: 928, y: GY - 6, at: at(4700), dur: 900, r: 26, n: 3, s: 1.2 }) +
    sparkle({ x: 300, y: 300, at: at(3900), dur: 900, r: 34, n: 3, s: 1.3 }) +
    lightbulb({ x: 800, y: GY - 300, at: at(5300), dur: 1800, scale: 1.0 });
  return cam.html(`${distantRoad(id)}${craterBack(id, cr)}${gem}${craterFront(id, cr)}${cart.html}${tc.html}${thief.html}${fx}`);
}

/* ------------------------------------------------------------------ montage: posts */

export function posts(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 520, y: 430, s: 1.0 });
  const y = yard(cues, id, { posts: 'anim', runs: { fl: 'none', fr: 'none', lw: 'none', rw: 'none', bk: 'none' }, gate: 'none', noLight: true });
  const W = [[260, 520], [620, 880], [1380, 1640], [2280, 2540]];
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 520, y: FY, scale: SC, flip: -1, face: 'plot', goggles: 'down', props: { F: torch(`${id}.tc`, flares(at, W)) }, armF: -70 });
  thief.propF.set(at(0), { rot: 40 });
  const tip = (i, dx) => ({ x: YARD.posts[i].x + dx, y: YARD.posts[i].y - 10 });
  const aim = (t0, dur, p) => aimAlong(thief, at(t0), dur, (s) => ({ x: p.x, y: p.y - 60 * (1 - s) }), { toolLen: TORCH_TIP.x, step: 90, prefer: 5, lead: 90 });
  const flip = (t, dir) => thief.root.to(at(t), 1, { flip: dir }, { ease: 'linear', reduce: 'snap' });

  aim(260, 260, tip(4, 10));
  y.post(4, at(330));
  flip(570, 1);
  aim(620, 260, tip(5, -10));
  y.post(5, at(690));
  flip(899, -1);
  thief.walk(at(900), 400, 330, { stride: 200, amp: 34, bounce: 7, swing: 0 });
  aim(1380, 260, tip(0, 12));
  y.post(0, at(1450));
  flip(1659, 1);
  thief.walk(at(1660), 560, 715, { stride: 220, amp: 34, bounce: 7, swing: 0 });
  aim(2280, 260, tip(1, -12));
  y.post(1, at(2350));
  // --- the rest go up in a flurry: torch swept toward the back, goggles up, hop
  thief.goggles(at(2600), 'up');
  thief.face(at(2600), 'cheer');
  thief.armF.to(at(2600), 260, { rot: -150 }, { ease: 'ease-out' });
  thief.propF.to(at(2600), 260, { rot: 70 }, { ease: 'ease-out' });
  thief.bob.hop(at(2650), 320, 36);
  y.post(2, at(2700), 240);
  y.post(3, at(2800), 240);

  const fx =
    spark(tip(4, 10), at(300), { seed: 1 }) + spark(tip(4, 10), at(430), { seed: 2, n: 6 }) + smoke(tip(4, 10), at(380)) +
    spark(tip(5, -10), at(660), { seed: 3 }) + spark(tip(5, -10), at(790), { seed: 4, n: 6 }) + smoke(tip(5, -10), at(740)) +
    spark(tip(0, 12), at(1420), { seed: 5 }) + spark(tip(0, 12), at(1550), { seed: 6, n: 6 }) + smoke(tip(0, 12), at(1500)) +
    spark(tip(1, -12), at(2320), { seed: 7 }) + spark(tip(1, -12), at(2450), { seed: 8, n: 6 }) + smoke(tip(1, -12), at(2400)) +
    dust({ x: 500, y: FY + 4, at: at(1200), n: 4, spread: 60, r: 20, dir: 1, seed: 3, dur: 600 }) +
    dust({ x: 560, y: FY + 4, at: at(2000), n: 4, spread: 60, r: 20, dir: -1, seed: 4, dur: 600 }) +
    [2, 3].map((i, k) => spark({ x: YARD.posts[i].x, y: YARD.posts[i].y - 100 }, at(2720 + k * 100), { n: 14, power: 190, seed: 20 + k, spread: 3.4 }) + rays({ x: YARD.posts[i].x, y: YARD.posts[i].y - 90, at: at(2720 + k * 100), r0: 30, r1: 90, n: 10, dur: 360, width: 5 })).join('') +
    pow({ x: 520, y: 330, at: at(2780), text: 'ZZZAP!', scale: 0.7, rot: -6, font: 58, dur: 900 });
  return `${cam.html(`${y.before}${y.after}${thief.html}${fx}`)}${flash({ at: at(2700), dur: 200, peak: 0.55 })}`;
}

/* ------------------------------------------------------------------ montage: iron */

export function iron(ctx) {
  const { cues, at, id } = ctx;
  const T0 = 350;
  const D = 1600;
  const cam = new Camera(cues, id, { x: 560, y: 380, s: 1.0 });
  cam.look(at(1950), 850, { x: 700, y: 400, s: 0.8 }, 'ease-in-out');
  const S1 = 1.5;
  const O1 = { x: 650, y: 297 };
  const flare = arc({ x: 0, y: 0, at: at(T0), dur: 130, n: Math.round(D / 130), r: 26 });
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 330, y: 760, scale: 2.4, face: 'plot', goggles: 'down', props: { F: torch(`${id}.tc`, flare) }, armF: -80 });
  thief.propF.set(at(0), { rot: 40 });
  const pt = (s) => {
    const p = scrollPoint(s);
    return { x: O1.x + p.x * S1, y: O1.y + p.y * S1 };
  };
  const tips = aimAlong(thief, at(T0), D, pt, { toolLen: TORCH_TIP.x, stand: () => 330, step: 80, prefer: -20, lead: 320 });
  thief.torso.keys(at(T0), D, Array.from({ length: 8 }, (_, i) => ({ o: (i + 1) / 8, x: i % 2 ? 2 : -2, y: i % 3 ? 1 : -1 })).concat([{ o: 1, x: 0, y: 0 }]), { ease: 'linear', reduce: 'skip' });
  [`${id}.s1.k`, `${id}.s1.line`].forEach((tg) => cues.push({ at: at(T0), dur: D, target: tg, easing: 'linear', keyframes: [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }] }));
  cues.push({ at: at(T0 + D + 100), dur: 700, target: `${id}.s1.line`, easing: 'linear', keyframes: [{ opacity: 1 }, { opacity: 0.2 }] });
  // the rest of the ironwork scrolls in a quick flurry as the camera pulls back
  const extra = [[225, 297, 1.5], [1075, 297, 1.5], [800, 560, 0.9], [510, 560, 0.9]].map(([x, yy, sc], i) => {
    [`${id}.e${i}.k`, `${id}.e${i}.line`].forEach((tg) => cues.push({ at: at(2000 + i * 150), dur: 450, target: tg, easing: 'ease-out', keyframes: [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }] }));
    return `<g transform="translate(${x} ${yy})">${scroll(`${id}.e${i}`, sc)}</g>`;
  }).join('');
  thief.goggles(at(1950), 'up');
  thief.face(at(1950), 'cheer');
  thief.armF.to(at(1950), 300, { rot: -150 }, { ease: 'ease-out' });
  thief.propF.to(at(1950), 300, { rot: 80 }, { ease: 'ease-out' });
  thief.bob.hop(at(2000), 300, 40);

  const fence = `<g>${(() => {
    // big, close pickets: reuse the same art as the yard so the montage matches
    return '';
  })()}</g>`;
  void fence;
  let fx = '';
  tips.forEach((p, i) => {
    if (i % 2 === 0) fx += spark(p, p.t, { n: 7, power: 150, seed: 60 + i, size: 1.2, angle: -1.9 });
    if (i % 5 === 0) fx += smoke(p, p.t, { r: 36, dy: -120 });
  });
  fx += [0, 1, 2, 3].map((i) => sparkle({ x: [225, 1075, 800, 510][i] + 30, y: [200, 200, 520, 520][i], at: at(2450 + i * 150), dur: 800, r: 30, n: 2, s: 1.2 })).join('');
  const bg = `<rect width="1280" height="720" fill="#161616"/><ellipse cx="640" cy="330" rx="700" ry="300" fill="url(#g-glow)" opacity=".18"/>`;
  // a close, oversized stretch of the fence (pickets + rails) behind the scrolls
  const pickets = [...Array(12)].map((_, i) => {
    const x = -200 + 141.7 * (i + 0.5);
    return `<path d="M${x - 18} 700 L${x - 18} 164 L${x} 140 L${x + 18} 164 L${x + 18} 700Z" fill="#3c3c3c" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><path d="M${x - 6} 180 L${x - 6} 690" stroke="#bbb" stroke-width="4" opacity=".6"/>`;
  }).join('');
  const rails = [588, 297].map((yy) => `<path d="M-300 ${yy} L1600 ${yy}" stroke="${INK}" stroke-width="30"/><path d="M-300 ${yy} L1600 ${yy}" stroke="#7a7a7a" stroke-width="16"/><path d="M-300 ${yy - 4} L1600 ${yy - 4}" stroke="#d6d6d6" stroke-width="4"/>`).join('');
  return `${bg}${cam.html(`${pickets}${rails}<g transform="translate(${O1.x} ${O1.y})">${scroll(`${id}.s1`, S1)}</g>${extra}${thief.html}${fx}`)}`;
}

/* ------------------------------------------------------------------ montage: gate + booth */

export function gateBooth(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 680, y: 440, s: 1.05 });
  const y = yard(cues, id, { gate: 'anim', noLight: true });
  const B = YARD.booth;
  const bo = booth(`${id}.bo`);
  const bBack = placed(cues, `${id}.bb`, bo.back, { x: B.x, y: B.y, sx: B.s, sy: 0 });
  const bFront = placed(cues, `${id}.bf`, bo.front, { x: B.x, y: B.y, sx: B.s, sy: 0 });
  const W = [[300, 800], [1750, 1980], [2100, 2350]];
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 520, y: FY, scale: SC, face: 'plot', goggles: 'down', props: { F: torch(`${id}.tc`, flares(at, W, 28)) }, armF: -80 });
  thief.propF.set(at(0), { rot: 40 });

  // the gate: drawn upward along its left hinge, then tested: open, shut
  aimAlong(thief, at(300), 500, (s) => ({ x: 452, y: 690 - 190 * s }), { toolLen: TORCH_TIP.x, step: 90, prefer: -10, lead: 280 });
  y.gateIn(at(300), 500);
  thief.face(at(850), 'smug');
  y.swing(at(1000), 380, true);
  y.swing(at(1420), 320, false);
  // the booth: welded together at speed
  thief.goggles(at(800), 'down');
  thief.root.to(at(1100), 1, { flip: 1 }, { ease: 'linear', reduce: 'snap' });
  thief.walk(at(1110), 560, 850, { stride: 240, amp: 34, bounce: 7, swing: 0 });
  aimAlong(thief, at(1750), 230, (s) => ({ x: 848, y: 700 - 20 * s }), { toolLen: TORCH_TIP.x, step: 90, prefer: 5, lead: 110 });
  bBack.track.keys(at(1800), 320, [{ o: 0.6, sy: B.s * 1.1 }, { o: 1, sy: B.s }], { ease: 'cubic-bezier(.2,.9,.3,1)', reduce: 'snap' });
  aimAlong(thief, at(2100), 250, (s) => ({ x: 842, y: 640 - 60 * s }), { toolLen: TORCH_TIP.x, step: 90, prefer: -10, lead: 100 });
  bFront.track.keys(at(2150), 320, [{ o: 0.6, sy: B.s * 1.1 }, { o: 1, sy: B.s }], { ease: 'cubic-bezier(.2,.9,.3,1)', reduce: 'snap' });
  thief.goggles(at(2480), 'up');
  thief.face(at(2480), 'cheer');
  thief.armF.to(at(2480), 260, { rot: -150 }, { ease: 'ease-out' });
  thief.propF.to(at(2480), 260, { rot: 80 }, { ease: 'ease-out' });
  thief.bob.hop(at(2530), 320, 36);

  const fx =
    spark({ x: 452, y: 640 }, at(400), { n: 10, seed: 1 }) + spark({ x: 452, y: 560 }, at(550), { n: 10, seed: 2 }) + spark({ x: 452, y: 500 }, at(700), { n: 10, seed: 3 }) +
    smoke({ x: 452, y: 540 }, at(600)) +
    pow({ x: 520, y: 400, at: at(1010), text: 'CREEEAK', scale: 0.55, rot: -6, font: 56, dur: 700 }) +
    spark({ x: 846, y: 690 }, at(1780), { n: 12, seed: 4 }) + spark({ x: 846, y: 640 }, at(2140), { n: 12, seed: 5 }) +
    pow({ x: 930, y: 380, at: at(1820), text: 'CLANG!', scale: 0.5, rot: 6, font: 56, dur: 600 }) +
    pow({ x: 930, y: 380, at: at(2180), text: 'CLANG!', scale: 0.5, rot: -6, font: 56, dur: 600 }) +
    dust({ x: B.x, y: B.y + 6, at: at(1800), n: 5, spread: 90, r: 22, dir: 0, seed: 5, dur: 700 }) +
    dust({ x: B.x, y: B.y + 6, at: at(2150), n: 5, spread: 90, r: 22, dir: 0, seed: 6, dur: 700 }) +
    mark({ x: B.x + 60, y: B.y - 400, at: at(2500), text: '*DING*', dur: 900, size: 46 }) +
    sparkle({ x: B.x - 70, y: B.y - 330, at: at(2350), dur: 900, r: 24, n: 2, s: 1.2 });
  return cam.html(`${y.before}${y.after}${bBack.html}${bFront.html}${thief.html}${fx}`);
}

/* ------------------------------------------------------------------ montage: the sign */

export function signUp(ctx) {
  const { cues, at, id } = ctx;
  const S = YARD.sign;
  const cam = new Camera(cues, id, { x: 400, y: 540, s: 1.3 });
  cam.look(at(3050), 650, { x: 560, y: 520, s: 1.05 }, 'ease-in-out');
  const y = yard(cues, id, { noLight: true });
  const bo = booth(`${id}.bo`);
  const sb = signboard(`${id}.sb`, TEXT.sign, YARD.sign);
  const sign = placed(cues, `${id}.sign`, sb.html, { x: S.x, y: S.y, sy: 0 });
  const TY = S.y + 10;
  const LINE = [[600, 0], [1200, 0], [1800, 0], [2400, 0]];
  const W = LINE.map(([t]) => [t, t + 480]);
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 60, y: TY, scale: SC, face: 'plot', goggles: 'down', props: { F: torch(`${id}.tc`, flares(at, W, 24)) }, armF: -80 });
  thief.propF.set(at(0), { rot: 40 });
  sign.track.keys(at(250), 420, [{ o: 0.6, sy: 1.08 }, { o: 1, sy: 1 }], { ease: 'cubic-bezier(.2,.9,.3,1)', reduce: 'snap' });
  let fx =
    dust({ x: S.x, y: S.y + 4, at: at(280), n: 7, spread: 150, r: 24, dir: 0, seed: 8, dur: 800 }) +
    pow({ x: S.x + 40, y: S.y - 300, at: at(600), text: 'CLANG!', scale: 0.5, rot: -6, font: 56, dur: 600 });
  const tipsAll = [];
  const widths = [300, 250, 230, 250];
  LINE.forEach(([t0, w], i) => {
    const ly = S.y + sb.lineY[i] - 16;
    const x0 = S.x - widths[i] / 2;
    const x1 = S.x + widths[i] / 2;
    const dur = 480;
    const tips = aimAlong(thief, at(t0), dur, (s) => ({ x: x0 + (x1 - x0) * s, y: ly }), { toolLen: TORCH_TIP.x, stand: (s) => x0 + (x1 - x0) * s - 78, step: 80, prefer: 0, lead: 90 });
    cues.push({ at: at(t0), dur, target: `${id}.sb.l${i}`, easing: 'linear', keyframes: [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], reduce: 'snap' });
    tips.forEach((p, k) => {
      if (k % 2 === 0) tipsAll.push(p);
    });
  });
  tipsAll.forEach((p, k) => (fx += spark(p, p.t, { n: 6, power: 100, seed: 80 + k, size: 0.9, angle: -1.2, spread: 2.4 })));
  tipsAll.forEach((p, k) => {
    if (k % 4 === 0) fx += smoke(p, p.t, { r: 22, dy: -80 });
  });
  thief.goggles(at(3000), 'up');
  thief.face(at(3000), 'cheer');
  thief.walk(at(3000), 500, 330, { stride: 240, amp: 28, bounce: 6, swing: 0 });
  thief.armF.to(at(3000), 260, { rot: -150 }, { ease: 'ease-out' });
  thief.propF.to(at(3000), 260, { rot: 80 }, { ease: 'ease-out' });
  fx += sparkle({ x: S.x - 120, y: S.y - 260, at: at(3100), dur: 900, r: 30, n: 3, s: 1.3 }) + sparkle({ x: S.x + 120, y: S.y - 150, at: at(3300), dur: 900, r: 26, n: 3, s: 1.2 });
  const boothStatic = `<g transform="translate(${YARD.booth.x} ${YARD.booth.y}) scale(${YARD.booth.s})">${bo.back}${bo.front}</g>`;
  return cam.html(`${y.before}${y.after}${boothStatic}${sign.html}${thief.html}${fx}`);
}

/* ------------------------------------------------------------------ montage: ready */

export function ready(ctx) {
  const { cues, at, id } = ctx;
  const S = YARD.sign;
  const cam = new Camera(cues, id, { x: 640, y: 470, s: 1.25 });
  cam.look(at(0), 2600, { x: 640, y: 440, s: 1.0 }, 'ease-in-out');
  const y = yard(cues, id, { noLight: true });
  const bo = booth(`${id}.bo`);
  const sb = signboard(`${id}.sb`, TEXT.sign, YARD.sign);
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 640, y: FY, scale: SC, face: 'cheer', goggles: 'up', props: { F: torch(`${id}.tc`) }, armF: -150 });
  thief.propF.set(at(0), { rot: 80 });
  // string lights come on, post by post
  const bulbs = YARD.posts.map((p, i) => ({ x: p.x, y: p.y - p.h - 40, i }));
  const lights = bulbs.map((b, k) => {
    cues.push({ at: at(500 + k * 150), dur: 160, target: `${id}.bulb${k}`, easing: 'steps(1,end)', keyframes: [{ opacity: 0 }, { opacity: 1 }] });
    return `<g data-t="${id}.bulb${k}" transform="translate(${b.x} ${b.y})"><circle r="46" fill="url(#g-glow)"/><circle r="11" fill="#fff" stroke="${INK}" stroke-width="4"/></g>`;
  }).join('');
  thief.head.keys(at(300), 1200, [{ o: 0.3, rot: fwd(thief, 6) }, { o: 0.6, rot: fwd(thief, -6) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  thief.bob.hop(at(300), 300, 24);
  thief.bob.hop(at(1500), 300, 24);
  const fx =
    sparkle({ x: 520, y: 220, at: at(300), dur: 1000, r: 44, n: 3, s: 1.4 }) +
    sparkle({ x: 440, y: 400, at: at(900), dur: 1000, r: 34, n: 3, s: 1.3 }) +
    sparkle({ x: 640, y: 320, at: at(1400), dur: 1000, r: 38, n: 3, s: 1.3 }) +
    rays({ x: 520, y: 400, at: at(300), r0: 160, r1: 330, n: 18, dur: 700, width: 6 });
  const boothStatic = `<g transform="translate(${YARD.booth.x} ${YARD.booth.y}) scale(${YARD.booth.s})">${bo.back}${bo.front}</g>`;
  const signStatic = `<g transform="translate(${S.x} ${S.y})">${sb.html}</g>`;
  return cam.html(`${y.before}${y.after}${boothStatic}${signStatic}${lights}${thief.html}${fx}`);
}

/* ------------------------------------------------------------------ the next morning: the queue */

const boothMarkup = (id) => {
  const bo = booth(`${id}.bo`);
  return { back: `<g transform="translate(${YARD.booth.x} ${YARD.booth.y}) scale(${YARD.booth.s})">${bo.back}</g>`, front: `<g transform="translate(${YARD.booth.x} ${YARD.booth.y}) scale(${YARD.booth.s})">${bo.front}</g>` };
};
const signMarkup = (id) => {
  const sb = signboard(`${id}.sb`, TEXT.sign, YARD.sign);
  return `<g transform="translate(${YARD.sign.x} ${YARD.sign.y})">${sb.html}</g>`;
};
/** The proprietor, in his booth window: top hat, bow tie, very pleased with himself. */
const proprietor = (cues, id, extra = {}) => {
  const B = YARD.booth;
  return prospector(cues, `${id}.thief`, { kind: 'thief', x: B.x, y: B.y - 24, scale: SC, face: 'smug', dressed: true, ...extra });
};

export function queue(ctx) {
  const { cues, at, id } = ctx;
  const B = YARD.booth;
  const QY = YARD.queueY;
  const cam = new Camera(cues, id, { x: 900, y: 520, s: 1.3 });
  cam.look(at(1500), 1000, { x: 1400, y: 470, s: 0.6 }, 'ease-in-out');
  cam.look(at(3600), 1100, { x: 1000, y: 500, s: 1.2 }, 'ease-in-out');
  const y = yard(cues, id, { day: true, noLight: true });
  const bm = boothMarkup(id);
  const thief = proprietor(cues, id);
  const pile = placed(cues, `${id}.pile`, creditPile(7, 360, 200), { x: 1130, y: B.y + 4, sx: 0.14, sy: 0.14 });
  const N = 14;
  const T = Array.from({ length: N }, (_, j) => tourist(cues, `${id}.t${j}`, { v: j, x: B.x + 96 * j, y: QY, scale: 0.88, flip: -1 }));
  const SPOTS = [400, 650, 360, 690, 450];
  const IN = SPOTS.map((x, k) => tourist(cues, `${id}.i${k}`, { v: k, x: 540, y: YARD.front + 4, scale: 0.8, flip: -1 }));
  const GROW = [0.3, 0.46, 0.64, 0.82, 1.0];
  let fx = '';

  for (let k = 0; k < 5; k++) {
    const t = 500 + 1000 * k;
    // the coin: out of the tourist's hand, up through the window
    const c = placed(cues, `${id}.coin${k}`, coin(1.3), { x: B.x - 14, y: QY - 120, sx: 0, sy: 0 });
    c.track.set(at(t), { sx: 1, sy: 1 });
    c.track.keys(at(t + 40), 380, [{ o: 0.5, y: QY - 300, x: B.x - 6 }, { o: 1, y: B.y - 230, x: B.x + 4, sx: 0.6, sy: 0.6 }], { seg: 'ease-out', ease: 'linear', reduce: 'snap' });
    c.track.set(at(t + 440), { sx: 0, sy: 0 });
    fx += c.html;
    // it lands on the pile: the pile swells
    pile.track.keys(at(t + 440), 420, [{ o: 0.5, sx: GROW[k] * 1.12, sy: GROW[k] * 1.12 }, { o: 1, sx: GROW[k], sy: GROW[k] }], { ease: 'cubic-bezier(.2,1.4,.4,1)', reduce: 'snap' });
    fx += sparkle({ x: 1100 + k * 8, y: B.y - 70 * GROW[k] - 40, at: at(t + 450), dur: 700, r: 20 + k * 3, n: 2, s: 1.2 });
    // the proprietor tips his hat, collects, grins
    thief.hat.keys(at(t + 420), 420, [{ o: 0.5, y: -30, rot: fwd(thief, 10) }, { o: 1, y: 0, rot: 0 }], { ease: 'ease-out', reduce: 'skip' });
    thief.face(at(t + 420), 'greed');
    thief.face(at(t + 900), 'smug');
    thief.bob.keys(at(t + 420), 300, [{ o: 0.5, y: -8 }, { o: 1, y: 0 }], { ease: 'ease-out', reduce: 'skip' });
    // the tourist goes through the gate (the outside copy hands over to the inside copy)
    T[k].walk(at(t + 500), 700, 540, { toY: YARD.front + 4, step: 350 });
    show(cues, `${id}.t${k}`, at(t + 1200), false);
    show(cues, `${id}.i${k}`, at(t + 1200), true);
    IN[k].walk(at(t + 1200), 650, SPOTS[k], { toY: GY + 52, step: 330 });
    IN[k].awe(at(t + 1900));
    // everyone behind shuffles forward
    for (let j = k + 1; j < N; j++) T[j].walk(at(t + 560), 420, T[j].root.p.x - 96, { step: 420, h: 5 });
  }
  fx += sparkle({ x: 520, y: 260, at: at(2200), dur: 1000, r: 40, n: 3, s: 1.4 }) + sparkle({ x: 640, y: 420, at: at(3600), dur: 1000, r: 34, n: 3, s: 1.3 });
  fx += puff({ x: 400, y: GY + 30, at: at(1600), dur: 1000, r: 22, dy: -30, opacity: 0.5 });

  return cam.html(`${y.before}${IN.map((i) => i.html).join('')}${y.after}${bm.back}${thief.html}${bm.front}${pile.html}${T.map((t) => t.html).join('')}${fx}`);
}

/* ------------------------------------------------------------------ the locked punchline: reread */

export function reread(ctx) {
  const { cues, at, id } = ctx;
  const B = YARD.booth;
  const cam = new Camera(cues, id, { x: B.x, y: B.y - 190, s: 1.9 });
  cam.look(at(3500), 700, { x: 1150, y: 520, s: 0.95 }, 'ease-in-out'); // the line of tourists
  cam.look(at(4250), 700, { x: 330, y: 560, s: 1.35 }, 'ease-in-out'); // the sign
  cam.look(at(5000), 800, { x: B.x, y: B.y - 190, s: 1.9 }, 'ease-in-out'); // and back to the proprietor
  const y = yard(cues, id, { day: true, noLight: true });
  const bm = boothMarkup(id);
  const thief = proprietor(cues, id);
  const pile = `<g transform="translate(1130 ${B.y + 4}) scale(1)">${creditPile(7, 360, 200)}</g>`;
  const QY = YARD.queueY;
  const T = Array.from({ length: 8 }, (_, j) => tourist(cues, `${id}.t${j}`, { v: j + 2, x: B.x + 96 * (j + 1) + 20, y: QY, scale: 0.88, flip: -1 }));
  const inside = SPOTS_INSIDE.map((x, k) => tourist(cues, `${id}.i${k}`, { v: k, x, y: GY + 52, scale: 0.8, flip: -1 }));
  const paper = placed(cues, `${id}.np`, newspaper({ w: 880, h: 1080, id: `${id}.pg`, lines: { name: TEXT.paperName, head: TEXT.headline, sub: TEXT.headlineSub } }), { x: B.x, y: B.y - 100, sx: 0.0001, sy: 0.0001 });
  const ins = `<g data-t="${id}.ins" style="opacity:0"><rect width="1280" height="720" fill="#f1efe9"/><rect width="1280" height="720" fill="url(#p-paper)" opacity=".6"/>
      <text x="640" y="170" font-size="54" font-weight="900" text-anchor="middle" fill="${INK}" font-family="Georgia, serif" letter-spacing="3">${TEXT.headline[0]}</text>
      <text x="640" y="270" font-size="100" font-weight="900" text-anchor="middle" fill="${INK}" font-family="Georgia, serif" letter-spacing="3">${TEXT.headline[1]}</text>
      <g transform="translate(640 470) rotate(-2)"><rect x="-470" y="-80" width="940" height="160" rx="6" fill="${INK}"/><text y="38" font-size="108" font-weight="900" text-anchor="middle" fill="#f4f4f4" font-family="Georgia, serif" letter-spacing="5">${TEXT.weekOnly}</text></g>
      <path data-t="${id}.ring" d="M150 470 C150 360 480 330 760 340 C1060 350 1150 410 1130 480 C1110 570 760 600 500 590 C260 580 120 560 150 470" pathLength="1" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round" stroke-dasharray="1 1" style="stroke-dashoffset:1"/>
    </g>`;

  // --- he takes out the original newspaper and unfolds it in front of his face
  thief.face(at(0), 'smug');
  thief.armF.to(at(300), 250, { rot: -40 }, { ease: 'ease-out' });
  paper.track.set(at(640), { x: B.x, y: B.y - 150 });
  paper.track.keys(at(650), 420, [{ o: 0.6, sx: 0.3, sy: 0.3 }, { o: 1, sx: 0.25, sy: 0.25 }], { ease: 'cubic-bezier(.2,1.2,.4,1)', reduce: 'snap' });
  show(cues, `${id}.np`, at(640), true);
  thief.armF.to(at(900), 250, { rot: -10 });
  paper.track.keys(at(1200), 700, [{ o: 0.3, rot: 2 }, { o: 0.6, rot: -2 }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  paper.track.to(at(1900), 300, { y: B.y - 95 }, { ease: 'ease-in-out' }); // lowers it: eyes over the top
  thief.face(at(1700), 'normal');
  // --- the insert: the headline's banner
  cues.push({ at: at(2200), dur: 140, target: `${id}.ins`, easing: 'linear', keyframes: [{ opacity: 0 }, { opacity: 1 }] });
  cues.push({ at: at(2300), dur: 800, target: `${id}.ring`, easing: 'ease-in-out', keyframes: [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }] });
  cues.push({ at: at(3400), dur: 120, target: `${id}.ins`, easing: 'linear', keyframes: [{ opacity: 1 }, { opacity: 0 }] });
  // --- looks at the paper, then at his profitable attraction, then at his sign... and smiles
  thief.face(at(3500), 'glance');
  thief.face(at(4300), 'normal');
  thief.face(at(5000), 'smug');
  thief.face(at(5500), 'cheer');
  thief.bob.keys(at(5500), 400, [{ o: 0.5, sy: 1.03 }, { o: 1, sy: 1 }], { ease: 'ease-out', reduce: 'skip' });
  thief.head.keys(at(3500), 1400, [{ o: 0.3, rot: fwd(thief, 10) }, { o: 0.6, rot: fwd(thief, 4) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  const fx = sparkle({ x: 330, y: 560, at: at(4500), dur: 900, r: 30, n: 2, s: 1.2 }) + sparkle({ x: 520, y: 300, at: at(3900), dur: 900, r: 34, n: 2, s: 1.2 });
  const stat = `${signMarkup(id)}`;
  return `${cam.html(`${y.before}${inside.map((i) => i.html).join('')}${y.after}${stat}${bm.back}${thief.html}${paper.html}${bm.front}${pile}${T.map((t) => t.html).join('')}${fx}`)}${ins}`;
}
const SPOTS_INSIDE = [400, 650, 360, 690, 450];

/* ------------------------------------------------------------------ the locked punchline: the plate */

export function plateScene(ctx) {
  const { cues, at, id } = ctx;
  const S = YARD.sign;
  const B = YARD.booth;
  const cam = new Camera(cues, id, { x: 520, y: 540, s: 1.1 });
  cam.look(at(1300), 600, { x: 260, y: 510, s: 1.5 }, 'ease-in-out');
  cam.look(at(4300), 1100, { x: 430, y: 500, s: 1.1 }, 'ease-in-out');
  const y = yard(cues, id, { day: true, noLight: true });
  const bm = boothMarkup(id);
  const pile = `<g transform="translate(1130 ${B.y + 4})">${creditPile(7, 360, 200)}</g>`;
  const proprietorBooth = '';
  void proprietorBooth;
  const TY = S.y + 10;
  const TACKS = [
    { t: 1700, tip: [S.x - 134, S.y - 290], sx: 110 },
    { t: 2200, tip: [S.x + 134, S.y - 290], sx: 250 },
    { t: 2700, tip: [S.x + 134, S.y - 56], sx: 290 },
    { t: 3200, tip: [S.x - 134, S.y - 56], sx: 100 },
  ];
  const W = TACKS.map((k) => [k.t, k.t + 330]);
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 700, y: TY, scale: SC, flip: -1, face: 'smug', dressed: true, goggles: 'down', props: { F: torch(`${id}.tc`, flares(at, W, 24)) }, armF: -80 });
  thief.propF.set(at(0), { rot: 40 });
  const pl = placed(cues, `${id}.plate`, plate(`${id}.pl`, S.w, S.h - 20, ['OPEN', 'DAILY'], 88), { x: 760, y: TY - 120, sx: 0.5, sy: 0.5 });

  // --- he carries the new plate in, held in front of him
  thief.walk(at(100), 1100, 330, { stride: 280, amp: 30, bounce: 6, swing: 0 });
  pl.track.to(at(100), 1100, { x: 330 + 44 }, { ease: 'linear', reduce: 'snap' });
  // --- and slaps it over the original sign
  const SLAP = 1250;
  pl.track.keys(at(SLAP), 340, [{ o: 0.6, x: S.x + 14, y: S.y - 180, sx: 1.08, sy: 1.08 }, { o: 1, x: S.x, y: S.y - (S.h + 20) / 2, sx: 1, sy: 1 }], { ease: 'cubic-bezier(.3,0,.5,1)', reduce: 'snap' });
  thief.face(at(SLAP + 340), 'plot');
  thief.goggles(at(SLAP + 340), 'down');
  // --- careful tack welds at the four corners
  let fx =
    pow({ x: S.x, y: S.y - 330, at: at(SLAP + 350), text: 'CLUNK', scale: 0.46, rot: -6, font: 56, dur: 600 }) +
    dust({ x: S.x, y: S.y - 20, at: at(SLAP + 340), n: 4, spread: 100, r: 18, dir: 0, seed: 3, dur: 600 });
  TACKS.forEach((k, i) => {
    const tips = aimAlong(thief, at(k.t), 330, (s) => ({ x: k.tip[0] + (i % 2 ? -10 : 10) * s, y: k.tip[1] + 8 * s }), { toolLen: TORCH_TIP.x, stand: () => k.sx, step: 90, prefer: 0, lead: 140 });
    fx += spark({ x: k.tip[0], y: k.tip[1] }, at(k.t + 40), { n: 10, power: 120, seed: 90 + i, size: 1 }) + spark({ x: k.tip[0], y: k.tip[1] }, at(k.t + 230), { n: 6, power: 90, seed: 95 + i, size: 0.9 }) + smoke({ x: k.tip[0], y: k.tip[1] }, at(k.t + 100), { r: 22, dy: -70 });
    void tips;
  });
  // --- done: goggles up, a satisfied step back
  thief.goggles(at(3600), 'up');
  thief.face(at(3600), 'smug');
  thief.armF.to(at(3600), 300, { rot: -20 });
  thief.propF.to(at(3600), 300, { rot: 0 });
  thief.walk(at(3750), 600, 520, { stride: 300, amp: 26, bounce: 5, swing: 0 });
  thief.face(at(4400), 'cheer');
  thief.bob.hop(at(4550), 300, 22);
  thief.head.keys(at(4400), 1000, [{ o: 0.3, rot: fwd(thief, 6) }, { o: 0.6, rot: fwd(thief, -4) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  fx += sparkle({ x: S.x - 90, y: S.y - 250, at: at(3800), dur: 900, r: 34, n: 3, s: 1.4 }) + sparkle({ x: S.x + 100, y: S.y - 110, at: at(4300), dur: 900, r: 30, n: 3, s: 1.3 }) + sparkle({ x: S.x + 10, y: S.y - 170, at: at(4800), dur: 900, r: 36, n: 2, s: 1.4 });
  const QY = YARD.queueY;
  const T = Array.from({ length: 6 }, (_, j) => tourist(cues, `${id}.t${j}`, { v: j + 1, x: B.x + 96 * (j + 1) + 20, y: QY, scale: 0.88, flip: -1 }));
  const inside = SPOTS_INSIDE.map((x, k) => tourist(cues, `${id}.i${k}`, { v: k, x, y: GY + 52, scale: 0.8, flip: -1 }));
  const proprietorT = proprietor(cues, id + '.pr');
  return cam.html(`${y.before}${inside.map((i) => i.html).join('')}${y.after}${signMarkup(id)}${pl.html}${bm.back}${proprietorT.html}${bm.front}${pile}${T.map((t) => t.html).join('')}${thief.html}${fx}`);
}
