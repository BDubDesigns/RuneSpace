/**
 * Beat 4 - The balloons (cut-away view: the Emerald, a gift-shop stall, the hole in the wall, the night plaza).
 *   balloons : he spots balloons, a terrible idea, and ties ever more of them to the Emerald until it floats.
 *   rise     : he pushes the floating Emerald through the hole (a very tight squeeze) and out. Success!
 *              It keeps rising; he leaps for the dangling rope.
 *   pop      : a tiny bird pecks one balloon. POP! They stretch, then POP POP POP-POP-POP: the Emerald falls.
 *   crash    : it lands in a crater; the thief crawls out from cover, dusty and defeated.
 */
import { prospector } from '../../../art/prospector.js';
import { emerald } from '../../../art/emerald.js';
import { balloon, bird, BalloonCloud } from '../../../art/balloons.js';
import { boulder, INK } from '../../../art/props.js';
import { dust, puff, mark, pow, rays, drops, flash, sparkle, rings, badIdea, chips, rng } from '../../../fx/effects.js';
import { Camera, fwd } from '../../../kit.js';
import { Track, show } from '../../../acting.js';
import { sectionBack, sectionFront, craterBack, craterFront, GY } from '../world.js';
import { EMX, EMS, EM_BASE } from './getaway.js';

const SC = 0.95;
const HUB = { x: 0, y: -504 }; // top of the Emerald (a rope sling), in the loaded Emerald's frame
const CLOUD = { count: 30, seed: 11, minLen: 90, maxLen: 125, spread: 210 };
export const CRATER_X = 1580;
const BOULDER_X = 1980;

const tailArt = () => `<path d="M0 0 Q-16 40 6 80 Q22 110 -4 140" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M0 0 Q-16 40 6 80 Q22 110 -4 140" fill="none" stroke="#d6d6d6" stroke-width="6" stroke-linecap="round"/><circle cx="-4" cy="146" r="11" fill="#d6d6d6" stroke="${INK}" stroke-width="4"/>`;

/**
 * The Emerald plus its sling, rope tail and balloons as ONE group, so it can rise, squash and fall together.
 * Origin = bottom centre of the Emerald. `gem` is the group's Track; `html` the markup (read it last).
 */
function loadedGem(cues, id, { x, y, count = CLOUD.count, placed = true, tail = true } = {}) {
  const gem = new Track(cues, `${id}.gem`, { x, y });
  const tailT = new Track(cues, `${id}.tail`, { x: 0, y: -4 });
  const cloud = new BalloonCloud(cues, `${id}.bal`, { hub: HUB, placed, ...CLOUD, count });
  return {
    gem,
    tail: tailT,
    cloud,
    get html() {
      return `<g data-t="${id}.gem" style="${gem.css}"><g transform="scale(${EMS})">${emerald(`${id}.em`, { w: 300, h: 360 })}</g>
        ${tail ? `<g data-t="${id}.tail" style="${tailT.css}">${tailArt()}</g>` : ''}
        <circle cx="${HUB.x}" cy="${HUB.y}" r="11" fill="#ddd" stroke="${INK}" stroke-width="4"/>
        ${cloud.html}</g>`;
    },
  };
}

const sway = (cues, track, at, dur, deg = 1.6, n = 4) =>
  track.keys(at, dur, Array.from({ length: n }, (_, i) => ({ o: (i + 1) / n, rot: i % 2 ? -deg : deg })).concat([{ o: 1, rot: 0 }]), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

/* ------------------------------------------------------------------ balloons */

export function balloons(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 470, y: 190, s: 0.8 });
  const mat = `<ellipse cx="${EMX}" cy="${GY - 4}" rx="290" ry="18" fill="#3c3c3c" stroke="${INK}" stroke-width="5"/><ellipse cx="${EMX}" cy="${GY - 8}" rx="250" ry="11" fill="#6a6a6a"/>`;
  const lg = loadedGem(cues, id, { x: EMX, y: EM_BASE, placed: false });
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 300, y: GY, scale: SC, face: 'sad', goggles: 'up' });

  // --- the gift-shop stall at the left, with four bunches (hidden group by group as he takes them)
  const rand = rng(6);
  const SHOP = { x: 110, hub: { x: 110, y: GY - 140 } };
  const SIZES = [1, 3, 8, 18];
  const groups = SIZES.map((n, gi) => {
    let g = '';
    for (let i = 0; i < n; i++) {
      const dx = (rand() - 0.5) * 2 * (50 + gi * 24);
      const len = 120 + rand() * (60 + gi * 36);
      g += `<path d="M${SHOP.hub.x} ${SHOP.hub.y} L${(SHOP.hub.x + dx).toFixed(0)} ${(SHOP.hub.y - len).toFixed(0)}" stroke="${INK}" stroke-width="2.4"/><g transform="translate(${(SHOP.hub.x + dx).toFixed(0)} ${(SHOP.hub.y - len).toFixed(0)})">${balloon(Math.floor(rand() * 5), 0.85 + rand() * 0.3)}</g>`;
    }
    return `<g data-t="${id}.shop${gi}">${g}</g>`;
  });
  const stall = `<g transform="translate(${SHOP.x} ${GY})"><rect x="-90" y="-130" width="180" height="130" fill="#a8a8a8" stroke="${INK}" stroke-width="6"/><rect x="-100" y="-146" width="200" height="22" fill="#e8e8e8" stroke="${INK}" stroke-width="5"/>
    <rect x="-70" y="-108" width="140" height="42" fill="#1c1c1c" stroke="${INK}" stroke-width="4"/><text y="-78" font-size="24" font-weight="900" text-anchor="middle" fill="#f4f4f4" font-family="Impact, sans-serif" letter-spacing="3">GIFT SHOP</text>
    <circle cx="0" cy="-140" r="8" fill="#ddd" stroke="${INK}" stroke-width="3"/></g>`;

  // balloons carried by the thief between the stall and the Emerald (one small group per bunch, each a Track)
  const carryArt = (n) => {
    let out = '';
    const m = Math.min(n, 10);
    for (let i = 0; i < m; i++) {
      const a = (i / Math.max(1, m - 1) - 0.5) * (m > 1 ? 80 : 0);
      const len = 90 + (i % 3) * 22;
      const kx = Math.sin((a * Math.PI) / 180) * len;
      const ky = -Math.cos((a * Math.PI) / 180) * len;
      out += `<path d="M0 0 L${kx.toFixed(0)} ${ky.toFixed(0)}" stroke="${INK}" stroke-width="2.4"/><g transform="translate(${kx.toFixed(0)} ${ky.toFixed(0)}) rotate(${(a * 0.4).toFixed(0)})">${balloon(i % 5, 0.9)}</g>`;
    }
    return out;
  };
  const carries = SIZES.map((n, gi) => ({ t: new Track(cues, `${id}.carry${gi}`, { x: 200, y: GY - 150, sx: 0, sy: 0 }), n }));
  const carry = carries.map((c, gi) => `<g data-t="${id}.carry${gi}" style="${c.t.css}">${carryArt(c.n)}</g>`).join('');

  // --- he comes to and spots the balloons: a terrible idea
  thief.head.keys(at(0), 500, [{ o: 0.5, rot: fwd(thief, -6) }, { o: 1, rot: 0 }], { ease: 'ease-in-out', reduce: 'skip' });
  thief.face(at(350), 'glance');
  thief.root.to(at(350), 1, { flip: -1 }, { ease: 'linear' }); // looks toward the stall
  thief.face(at(700), 'shock');
  thief.bob.hop(at(700), 240, 14);
  thief.face(at(1000), 'plot');
  thief.vibrate(at(1050), 300, 2.2);

  const S = 205; // stall side
  const T = 440; // toss spot, left of the Emerald
  const leg = (t0, from, to, dur, gi = -1, lift = 0) => {
    // walk from `from` to `to`; the carried bunch follows (linear, same timing as walk())
    const dir = to > from ? 1 : -1;
    thief.root.to(at(t0 - 1), 1, { flip: dir }, { ease: 'linear', reduce: 'snap' });
    thief.walk(at(t0), dur, to, { stride: 220, amp: 34, bounce: lift || 6, swing: 0 });
    if (gi >= 0) carries[gi].t.to(at(t0), dur, { x: to + 30 * dir }, { ease: 'linear', reduce: 'snap' });
  };
  const grab = (t, gi) => {
    show(cues, `${id}.shop${gi}`, at(t), false);
    carries[gi].t.set(at(t), { x: thief.root.p.x + 30 * thief.root.p.flip, y: GY - 150, sx: 1, sy: 1 });
    thief.face(at(t), 'smug');
  };
  const toss = (t, gi, from, to) => {
    thief.armF.to(at(t - 150), 150, { rot: 25 }, { ease: 'ease-in' });
    thief.armF.to(at(t), 220, { rot: -168 }, { ease: 'cubic-bezier(.2,.8,.3,1)' });
    thief.bob.hop(at(t), 300, 46);
    carries[gi].t.set(at(t), { sx: 0, sy: 0 });
    const gap = to - from > 5 ? 42 : 110;
    lg.cloud.releaseRange(from, to, at(t + 80), gap);
    thief.armF.to(at(t + 520), 260, { rot: -10 }, { ease: 'ease-in-out' });
    return t + 80 + (to - from) * gap + 820; // when the last one has settled
  };

  // run 1: ONE balloon. Nothing.
  leg(1350, 300, S, 420, -1);
  grab(1800, 0);
  leg(1830, S, T, 450, 0);
  const done1 = toss(2420, 0, 0, 1);
  thief.face(at(done1 - 500), 'sad');
  // run 2: three. Nothing.
  leg(2800, T, S, 400, -1);
  grab(3230, 1);
  leg(3260, S, T, 450, 1);
  const done2 = toss(3850, 1, 1, 4);
  thief.face(at(done2 - 500), 'angry');
  // run 3: eight. The Emerald shivers.
  leg(4200, T, S, 380, -1);
  grab(4610, 2);
  leg(4640, S, T, 450, 2);
  const done3 = toss(5230, 2, 4, 12);
  lg.gem.keys(at(done3 - 700), 700, Array.from({ length: 8 }, (_, i) => ({ o: (i + 1) / 8, x: EMX + (i % 2 ? 3 : -3), y: EM_BASE - (i % 3 ? 4 : 0) })).concat([{ o: 1, x: EMX, y: EM_BASE }]), { ease: 'linear', reduce: 'skip' });
  thief.face(at(done3 - 600), 'greed');
  // run 4: all the rest. The load lifts HIM off the ground.
  leg(5600, T, S, 360, -1);
  grab(5990, 3);
  leg(6020, S, T, 560, 3, 34);
  const done4 = toss(6700, 3, 12, 30);
  // --- liftoff
  const LIFT = 7800;
  lg.gem.keys(at(LIFT), 1000, [{ o: 0.3, y: EM_BASE - 4 }, { o: 1, y: EM_BASE - 96 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'snap' });
  sway(cues, lg.gem, at(LIFT + 1000), 300, 1.4, 2);
  sway(cues, lg.tail, at(LIFT + 400), 1200, 7, 5);
  thief.face(at(LIFT), 'cheer');
  thief.bob.hop(at(LIFT + 150), 320, 30);
  thief.bob.hop(at(LIFT + 650), 320, 30);
  thief.armF.to(at(LIFT + 300), 200, { rot: -160 });
  thief.armB.to(at(LIFT), 200, { rot: -160 });
  void done4;

  const fx =
    badIdea({ x: 285, y: GY - 270, at: at(1000), dur: 1000, scale: 0.9 }) +
    mark({ x: 275, y: GY - 270, at: at(700), dur: 600, size: 70 }) +
    dust({ x: EMX, y: GY + 4, at: at(LIFT), n: 8, spread: 200, r: 30, dir: 0, seed: 5, dur: 900 }) +
    sparkle({ x: 740, y: 180, at: at(LIFT + 400), dur: 900, r: 34, n: 3, s: 1.3 }) +
    [1, 2, 3].map((i) => puff({ x: 340 + i * 40, y: GY - 6, at: at(1350 + i * 80), dur: 500, r: 18, dy: -14, dx: -20 })).join('');
  return cam.html(`${sectionBack(id)}${stall}${groups.join('')}${mat}${lg.html}${thief.html}${carry}${sectionFront()}${fx}`);
}

/* ------------------------------------------------------------------ rise */

export function rise(ctx) {
  const { cues, at, id } = ctx;
  const FLOAT0 = EM_BASE - 96;
  const cam = new Camera(cues, id, { x: 560, y: 250, s: 0.8 });
  const lg = loadedGem(cues, id, { x: EMX, y: FLOAT0 });
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: EMX - 300, y: GY, scale: SC, face: 'cheer', goggles: 'up', armF: -160, armB: -160 });
  const mat = `<ellipse cx="${EMX}" cy="${GY - 4}" rx="290" ry="18" fill="#3c3c3c" stroke="${INK}" stroke-width="5"/><ellipse cx="${EMX}" cy="${GY - 8}" rx="250" ry="11" fill="#6a6a6a"/>`;

  // --- he steers it toward the hole, hands on its flank
  thief.face(at(0), 'smug');
  thief.armF.to(at(0), 380, { rot: -86 }, { ease: 'ease-out' });
  thief.armB.to(at(0), 380, { rot: -92 }, { ease: 'ease-out' });
  sway(cues, lg.tail, at(0), 1600, 6, 5);
  lg.gem.to(at(400), 1300, { x: 805 }, { ease: 'ease-in-out', reduce: 'snap' });
  thief.walk(at(400), 1300, 505, { stride: 300, amp: 22, bounce: 4, swing: 0 });
  // jam: the Emerald meets the wall
  const JAM = 1700;
  lg.gem.keys(at(JAM), 380, [{ o: 0.4, x: 800, rot: -1.5 }, { o: 1, x: 806, rot: 0 }], { ease: 'ease-out', reduce: 'skip' });
  thief.face(at(JAM), 'angry');
  thief.torso.to(at(JAM + 100), 300, { rot: fwd(thief, 14) }, { ease: 'ease-out' });
  thief.vibrate(at(JAM + 400), 1100, 3);
  cam.shake(at(JAM), 380, 8);
  cam.look(at(2200), 1800, { x: 1000, y: 280, s: 0.8 }, 'ease-in-out');
  // a very tight squeeze: the whole load flattens into the opening, then oozes through
  const SQ = 2400;
  const SQ_END = 4100;
  lg.gem.to(at(2100), 280, { y: EM_BASE - 20 }, { ease: 'ease-in-out', reduce: 'snap' });
  lg.gem.keys(at(SQ), 500, [{ o: 1, sy: 0.3, sx: 1.02 }], { ease: 'cubic-bezier(.3,0,.2,1)', reduce: 'snap' });
  lg.gem.to(at(SQ + 500), SQ_END - SQ - 500, { x: 1400 }, { ease: 'ease-in-out', reduce: 'snap' });
  thief.walk(at(SQ + 500), SQ_END - SQ - 500, 1100, { stride: 380, amp: 22, bounce: 4, swing: 0 });
  // out it pops, with a boing
  lg.gem.keys(at(SQ_END), 640, [{ o: 0.3, sy: 1.34, sx: 0.84, y: EM_BASE - 70 }, { o: 0.6, sy: 0.9, sx: 1.08 }, { o: 1, sy: 1, sx: 1, y: EM_BASE - 96 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'snap' });
  thief.face(at(SQ_END), 'cheer');
  thief.torso.to(at(SQ_END), 200, { rot: 0 });
  thief.walk(at(SQ_END + 200), 700, 1250, { stride: 300, amp: 22, bounce: 6, swing: 0 });
  thief.armF.to(at(SQ_END + 200), 260, { rot: -165 });
  thief.armB.to(at(SQ_END + 200), 260, { rot: -165 });
  cam.look(at(4300), 1000, { x: 1350, y: 150, s: 0.68 }, 'ease-in-out');
  // it keeps rising: and rising: faster every moment
  const R0 = 4800;
  lg.gem.keys(at(R0), 1550, [
    { o: 0.2, y: FLOAT0 - 26, x: 1415, ease: 'ease-in' },
    { o: 0.45, y: 200, x: 1430, ease: 'ease-in' },
    { o: 1, y: -200, x: 1470, ease: 'linear' },
  ], { ease: 'linear', reduce: 'snap' });
  sway(cues, lg.tail, at(R0), 1500, 12, 6);
  // the thief realises, runs under it, leaps: the knot is always just out of reach
  thief.face(at(5000), 'shock');
  thief.walk(at(5050), 300, 1400, { stride: 200, amp: 30, bounce: 5, swing: 0 });
  thief.bob.hop(at(5380), 360, 100);
  thief.bob.hop(at(5800), 360, 90);
  thief.armF.to(at(5360), 120, { rot: -175 });
  thief.armB.to(at(5360), 120, { rot: -178 });
  thief.face(at(6000), 'sad');
  cam.look(at(5400), 900, { x: 1400, y: -120, s: 0.5 }, 'ease-in-out');

  const fx =
    pow({ x: 940, y: 290, at: at(JAM + 20), text: 'CLUNK', scale: 0.5, rot: -7, font: 58, dur: 700 }) +
    pow({ x: 1090, y: 120, at: at(SQ + 500), text: 'SQUEEEEZE', scale: 0.72, rot: 5, font: 50, dur: 1500 }) +
    [0, 1, 2, 3].map((i) => chips({ x: 1020 + (i % 2) * 150, y: GY - 258, at: at(SQ + 700 + i * 380), n: 4, power: 70, seed: 3 + i, fill: '#9a9a9a', angle: i % 2 ? 0.2 : Math.PI - 0.2, spread: 1.4, dur: 500 })).join('') +
    drops({ x: 800, y: 380, at: at(JAM + 500), n: 4, seed: 11, spread: 80 }) +
    pow({ x: 1300, y: 160, at: at(SQ_END + 20), text: 'BOING!', scale: 0.56, rot: -7, font: 60, dur: 800 }) +
    dust({ x: 1100, y: GY + 4, at: at(SQ_END), n: 5, spread: 80, r: 22, dir: 1, seed: 13, dur: 700 }) +
    mark({ x: 1400, y: 330, at: at(5020), dur: 900, size: 82 }) +
    sparkle({ x: 1330, y: 120, at: at(SQ_END + 400), dur: 800, r: 32, n: 3, s: 1.3 });
  return cam.html(`${sectionBack(id)}${mat}${lg.html}${thief.html}${sectionFront()}${fx}`);
}

/* ------------------------------------------------------------------ pop */

export function pop(ctx) {
  const { cues, at, id } = ctx;
  const GX = 1500;
  const GY0 = -140; // Emerald base y when the scene opens (it keeps drifting up)
  const cam = new Camera(cues, id, { x: 1500, y: -180, s: 0.4 });
  const lg = loadedGem(cues, id, { x: GX, y: GY0 });
  cam.look(at(500), 2300, { x: 1515, y: -760, s: 1.0 }, 'ease-in-out'); // push in on the balloons as the bird arrives
  cam.look(at(4000), 900, { x: 1500, y: -200, s: 0.42 }, 'ease-in-out'); // and back out for the cascade
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 1400, y: GY, scale: SC, face: 'shock', goggles: 'up', armF: -150, armB: -10 });
  const crow = new Track(cues, `${id}.bird`, { x: 380, y: -760, sx: 1.7, sy: 1.7 });
  const head = new Track(cues, `${id}.bird.head`);
  const wA = new Track(cues, `${id}.bird.wA`);
  const wB = new Track(cues, `${id}.bird.wB`);
  const birdArt = bird(`${id}.bird`);

  // --- the Emerald drifts up; he shades his eyes
  lg.gem.keys(at(0), 3700, [{ o: 0.25, y: GY0 - 15, x: GX + 8, rot: 1.2 }, { o: 0.5, y: GY0 - 30, x: GX + 14, rot: -1.2 }, { o: 0.75, y: GY0 - 45, x: GX + 12, rot: 1 }, { o: 1, y: GY0 - 58, x: GX + 10, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'snap' });
  sway(cues, lg.tail, at(0), 3000, 10, 6);
  thief.head.to(at(0), 300, { rot: fwd(thief, -14) });
  thief.root.keys(at(300), 2400, [{ o: 0.3, rot: fwd(thief, -3) }, { o: 0.6, rot: fwd(thief, 2) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  const ballTarget = lg.cloud.items.map((it, i) => ({ i, y: it.ky })).sort((a, b) => a.y - b.y)[0]; // the highest balloon
  const bt = lg.cloud.pos(ballTarget.i);
  const gx = GX + 10; // the group's x at peck time (see keys above: ~GX + 10)
  const gyAt = GY0 - 58;
  const bx = gx + bt.x - 74; // bird sits just left of the balloon, beak toward it
  const by = gyAt + bt.y - 40;

  // --- the bird: it simply flies across, flapping, as if nothing is going on
  const FL0 = 700;
  const FL1 = 2800;
  const flap = (t, dur, n) => {
    wA.keys(at(t), dur / n, [{ o: 0.5, rot: -34 }, { o: 1, rot: 22 }], { seg: 'ease-in-out', ease: 'linear', iterations: n, reduce: 'skip' });
    wB.keys(at(t), dur / n, [{ o: 0.5, rot: 22 }, { o: 1, rot: -30 }], { seg: 'ease-in-out', ease: 'linear', iterations: n, reduce: 'skip' });
  };
  flap(FL0, FL1 - FL0, 11);
  crow.keys(at(FL0), FL1 - FL0, [
    { o: 0.2, x: 700, y: -690 },
    { o: 0.4, x: 980, y: -780 },
    { o: 0.6, x: 1260, y: -690 },
    { o: 0.8, x: bx - 120, y: by - 20 },
    { o: 1, x: bx, y: by },
  ], { seg: 'ease-in-out', ease: 'linear', reduce: 'snap' });
  // wind-up (head back) ... PECK
  const PECK = 3200;
  head.keys(at(FL1), PECK - FL1, [{ o: 0.5, rot: 10 }, { o: 1, rot: -26 }], { ease: 'ease-in-out', reduce: 'skip' });
  head.to(at(PECK), 90, { rot: 24 }, { ease: 'cubic-bezier(.6,0,1,.6)' });
  head.to(at(PECK + 160), 260, { rot: 0 }, { ease: 'ease-out' });
  flap(FL1, PECK - FL1 + 500, 4);
  // the bird is startled backward, then flutters off unimpressed
  crow.keys(at(PECK), 500, [{ o: 0.4, x: bx - 30, y: by - 40, rot: -20 }, { o: 1, x: bx - 14, y: by - 20, rot: -6 }], { ease: 'ease-out', reduce: 'snap' });
  crow.keys(at(PECK + 800), 1600, [{ o: 0.4, x: bx + 360, y: by - 140, rot: -8 }, { o: 1, x: bx + 1100, y: by - 260, rot: 0 }], { ease: 'ease-in', reduce: 'snap' });
  flap(PECK + 800, 1600, 7);

  // --- POP, a moment of silence, then the load stretches and the cascade begins
  lg.cloud.pop(ballTarget.i, at(PECK));
  const order = [...Array(lg.cloud.count).keys()].filter((i) => i !== ballTarget.i);
  const r = rng(77);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const STRETCH = PECK + 520;
  lg.cloud.stretch(at(STRETCH), 600, 1.5);
  lg.gem.keys(at(STRETCH), 650, [{ o: 0.5, y: GY0 - 20 }, { o: 1, y: GY0 - 34 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'snap' });
  thief.face(at(STRETCH), 'shock');
  let t = PECK + 1200;
  const times = [];
  let gap = 120;
  order.forEach((bi, k) => {
    lg.cloud.pop(bi, at(Math.round(t)));
    times.push(Math.round(t));
    t += gap;
    gap = Math.max(22, gap * (k < 3 ? 0.9 : 0.78));
  });
  const FALL = 4700;
  lg.gem.keys(at(FALL), 1000, [{ o: 1, y: GY0 + 580, x: GX, rot: -3 }], { ease: 'cubic-bezier(.5,.05,.9,.6)', reduce: 'snap' });
  // he bolts for the boulder
  thief.face(at(FALL - 600), 'shock');
  thief.walk(at(FALL - 500), 1300, 1930, { stride: 200, amp: 38, bounce: 7, swing: 30 });

  const fx =
    times.map((tm, i) => (i % 2 === 0 ? pow({ x: GX + lg.cloud.pos(order[i]).x * 1.2, y: GY0 + lg.cloud.pos(order[i]).y - 70, at: at(tm), text: ['POP!', 'POP!', 'POP!'][i % 3], scale: 0.7 + (i % 3) * 0.1, rot: (i % 2 ? 8 : -8) + i, font: 60, dur: 420 }) : '')).join('') +
    pow({ x: bx + 120, y: by - 120, at: at(PECK + 10), text: 'POP!', scale: 1.5, rot: -7, font: 60, dur: 900 }) +
    puff({ x: bx + 60, y: by + 30, at: at(PECK + 20), dur: 800, r: 40, dy: -30 });
  return cam.html(`${sectionBack(id)}${lg.html}<g data-t="${id}.bird" style="${crow.css}"><g transform="scale(1)">${birdArt}</g></g>${thief.html}${sectionFront()}${fx}`);
}

/* ------------------------------------------------------------------ crash */

export function crash(ctx) {
  const { cues, at, id } = ctx;
  const IMPACT = 1050;
  const cam = new Camera(cues, id, { x: 1740, y: 400, s: 0.9 });
  cam.look(at(3000), 2800, { x: 1620, y: 420, s: 1.05 }, 'ease-in-out');
  const lg = loadedGem(cues, id, { x: CRATER_X, y: -150, count: 0 });
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: BOULDER_X - 40, y: GY, scale: SC, face: 'shock', goggles: 'up' });
  const rock = `<g transform="translate(${BOULDER_X} ${GY + 6})">${boulder(330, 250)}</g>`;
  const cracks = `<g data-t="${id}.cracks" style="opacity:0"><path d="M${CRATER_X - 330} ${GY + 20} l-90 -10 l-60 18 M${CRATER_X + 330} ${GY + 18} l100 -8 l70 20 M${CRATER_X - 120} ${GY + 70} l-40 40 l10 40 M${CRATER_X + 160} ${GY + 70} l40 34 l-6 46" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  cues.push({ at: at(IMPACT), dur: 200, target: `${id}.cracks`, easing: 'ease-out', keyframes: [{ opacity: 0 }, { opacity: 1 }] });

  // --- the Emerald plummets into the crater, bounces once, settles tilted
  lg.gem.keys(at(0), IMPACT, [{ o: 1, y: GY + 38 }], { ease: 'cubic-bezier(.5,.05,.9,.6)', reduce: 'snap' });
  lg.gem.keys(at(IMPACT), 700, [{ o: 0.25, y: GY - 14, rot: 3 }, { o: 0.55, y: GY + 44, rot: -4 }, { o: 1, y: GY + 38, rot: 4 }], { seg: 'ease-out', ease: 'linear', reduce: 'snap' });
  cam.shake(at(IMPACT), 1300, 26, 40);
  // crater swells
  cues.push({ at: at(IMPACT), dur: 300, target: `${id}.crater`, easing: 'cubic-bezier(.2,1.4,.4,1)', keyframes: [{ transform: `translate(${CRATER_X}px, ${GY + 6}px) scale(0.85, 0.85)` }, { transform: `translate(${CRATER_X}px, ${GY + 6}px) scale(1, 1)` }], reduce: 'snap' });

  // --- the thief: ears covered, ducks behind the boulder
  thief.bob.set(at(0), { sy: 0.8, sx: 1.05 });
  thief.armF.to(at(0), 200, { rot: -150 });
  thief.armB.to(at(0), 200, { rot: -150 });
  thief.face(at(IMPACT - 200), 'ko');
  thief.bob.to(at(IMPACT), 160, { sy: 0.62, sx: 1.1 }, { ease: 'ease-out' });
  // after the dust: hat first, then eyes
  const PEEK = 3000;
  thief.bob.to(at(PEEK), 500, { sy: 0.97, sx: 1 }, { ease: 'ease-in-out' });
  thief.face(at(PEEK + 100), 'glance');
  thief.armF.to(at(PEEK), 400, { rot: 0 });
  thief.armB.to(at(PEEK), 400, { rot: 0 });
  // crawls out, stooped and dusty, and trudges to the Emerald
  const OUT = 3800;
  thief.face(at(OUT - 200), 'sad');
  thief.root.to(at(OUT), 1, { flip: -1 }, { ease: 'linear', reduce: 'snap' });
  thief.walk(at(OUT), 1500, 1275, { stride: 330, amp: 20, bounce: 3, swing: 0 });
  thief.torso.to(at(OUT), 300, { rot: fwd(thief, 14), y: 6 }, { ease: 'ease-out' });
  thief.torso.to(at(OUT + 1500), 400, { rot: 0, y: 0 }, { ease: 'ease-in-out' });
  // dusts himself off (a hat shake, two pats), then just stares
  thief.hat.keys(at(OUT + 1700), 400, [{ o: 0.3, rot: fwd(thief, 10) }, { o: 0.6, rot: fwd(thief, -8) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });

  const clouds = [0, 1, 2, 3, 4, 5].map((i) => dust({ x: CRATER_X - 300 + i * 120, y: GY + 10, at: at(IMPACT + i * 60), n: 6, spread: 120, r: 70, dir: i < 3 ? -1 : 1, seed: 50 + i, dur: 2200 })).join('');
  const fx =
    clouds +
    rings({ x: CRATER_X, y: GY + 20, at: at(IMPACT), n: 3, gap: 150, dur: 900, r: 360, width: 9 }) +
    chips({ x: CRATER_X, y: GY + 10, at: at(IMPACT), n: 14, power: 360, seed: 8, fill: '#444', size: 1.8, dur: 1400 }) +
    chips({ x: CRATER_X, y: GY + 10, at: at(IMPACT + 40), n: 12, power: 260, seed: 9, fill: '#bbb', size: 1.4, dur: 1300 }) +
    rays({ x: CRATER_X, y: GY - 60, at: at(IMPACT), r0: 120, r1: 330, n: 16, dur: 480, width: 9 }) +
    pow({ x: CRATER_X - 40, y: 190, at: at(IMPACT + 30), text: 'KRA-KOOM!', scale: 1.4, rot: -6, font: 52, dur: 1700 }) +
    puff({ x: BOULDER_X - 30, y: GY - 200, at: at(PEEK + 300), dur: 800, r: 26, dy: -30, opacity: 0.6 }) +
    puff({ x: 1285, y: GY - 120, at: at(OUT + 1800), dur: 900, r: 36, dy: -40, dx: -20, opacity: 0.7 }) +
    puff({ x: 1290, y: GY - 160, at: at(OUT + 2000), dur: 900, r: 30, dy: -40, dx: 20, opacity: 0.7 }) +
    sparkle({ x: CRATER_X + 40, y: 360, at: at(OUT + 600), dur: 900, r: 34, n: 3, s: 1.3 });
  return `${cam.html(`${sectionBack(id)}${craterBack(id, { x: CRATER_X, rx: 300, ry: 46 })}${lg.html}${craterFront(id, { x: CRATER_X, rx: 300, ry: 46 })}${cracks}${thief.html}${rock}${sectionFront()}${fx}`)}${flash({ at: at(IMPACT), dur: 240, peak: 0.8 })}`;
}
