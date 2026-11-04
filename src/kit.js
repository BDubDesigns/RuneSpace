/**
 * Film-agnostic scene helpers shared by every film (they only depend on acting.js and the
 * prospector rig): Camera, driftClouds, idle, fwd, blow, popIn, reach, aimAlong, filmHelpers.
 */
import { Track, tween } from './acting.js';
import { card } from './art/cards.js';

/** Camera: a tracked group; pose is expressed as a focus point + zoom. */
export class Camera extends Track {
  constructor(cues, id, focus = { x: 640, y: 360, s: 1 }) {
    super(cues, `${id}.cam`);
    this.f = { ...focus };
    this.p = Camera.pose(this.f);
  }
  static pose({ x, y, s }) {
    return { x: 640 - x * s, y: 360 - y * s, sx: s, sy: s, rot: 0, flip: 1 };
  }
  /** Move to focus (x, y, s) over dur. Large pans snap in reduced-motion mode. */
  look(at, dur, f, ease = 'ease-in-out') {
    this.f = { ...this.f, ...f };
    return this.to(at, dur, Camera.pose(this.f), { ease, reduce: 'snap' });
  }
  /** Decaying screenshake (skipped entirely in reduced-motion mode). */
  shake(at, dur, px = 12, rate = 55) {
    const base = { ...this.p };
    const n = Math.max(2, Math.round(dur / rate));
    const frames = [];
    for (let i = 1; i < n; i++) {
      const k = 1 - i / n;
      const sx = (i % 2 ? 1 : -1) * px * k;
      const sy = (i % 3 ? -0.6 : 0.8) * px * k;
      frames.push({ o: i / n, x: base.x + sx, y: base.y + sy });
    }
    frames.push({ o: 1, x: base.x, y: base.y });
    return this.keys(at, dur, frames, { ease: 'linear', reduce: 'skip' });
  }
  html(inner) {
    return `<g data-t="${this.target}" style="${this.css}">${inner}</g>`;
  }
}

/**
 * Slow cloud drift for the length of a scene. Targets `${id}.cloudA|cloudB|cloudC`, the three
 * clouds that `sky(id)` in a film's world.js draws; a film with no clouds simply doesn't call it.
 */
export function driftClouds(ctx, id) {
  const dur = ctx.dur;
  [['cloudA', 40], ['cloudB', 26], ['cloudC', 55]].forEach(([c, px]) => {
    tween(ctx.cues, `${id}.${c}`, ctx.at(0), dur, { transform: 'translateX(0px)' }, { transform: `translateX(${px}px)` }, { reduce: 'skip' });
  });
}

/** Gentle breathing sway on an idle character's body (cheap life). */
export function idle(c, from, to, rate = 900) {
  const n = Math.max(1, Math.round((to - from) / rate));
  c.bob.keys(from, to - from, Array.from({ length: n * 2 }, (_, i) => ({ o: (i + 1) / (n * 2), sy: i % 2 ? 1 : 1.018, sx: i % 2 ? 1 : 0.992 })), { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
}

/** Forward lean in degrees (positive = toward the way the character faces). */
export const fwd = (c, deg) => deg * c.root.p.flip;

/**
 * One overhead mallet blow: wind-up (up ms), strike (dn ms). Returns the impact time.
 * The character must be holding a mallet in the front hand.
 */
export function blow(c, t, up = 230, dn = 90) {
  c.armF.to(t, up, { rot: -162 }, { ease: 'ease-out' });
  c.root.to(t, up, { rot: fwd(c, -6) }, { ease: 'ease-out' });
  c.armF.to(t + up, dn, { rot: -20 }, { ease: 'cubic-bezier(.6,0,1,.6)' });
  c.root.to(t + up, dn, { rot: fwd(c, 6) }, { ease: 'ease-in' });
  return t + up + dn;
}

/**
 * Two-link IK for a hand-held tool (a torch): the arm swings from the shoulder, the tool pivots at the hand.
 * Returns the `{ arm, prop }` rotations (degrees) for `c.armF` and `c.propF` that put the tool's tip on the
 * world point (tx, ty). The tool points along +x from the grip and is `toolLen` long (torch: TORCH_TIP.x).
 * `prefer` picks which of the two solutions (elbow bend) to use: the one whose tool angle is closest to it
 * (degrees, in the character's own, un-flipped frame; the default points the tool forward and slightly down).
 * Out-of-range targets are clamped to the nearest reachable point. `pose` overrides the character's root pose
 * (e.g. `{ x }`) so you can solve for where it WILL be standing.
 *
 *   const { arm, prop } = reach(thief, 700, 400, TORCH_TIP.x);
 *   thief.armF.to(at(0), 300, { rot: arm }); thief.propF.to(at(0), 300, { rot: prop });
 */
export function reach(c, tx, ty, toolLen, prefer = 10, pose = null) {
  const root = pose ? { ...c.root.p, ...pose } : c.root.p;
  const sc = root.sx;
  const k = c.dims;
  // target in the character's local (unflipped, unscaled) frame, relative to the shoulder
  const lx = ((tx - root.x) / (sc * root.flip)) - k.sh;
  const ly = (ty - root.y) / sc - (-k.L - k.T + k.shY);
  const l1 = k.armL;
  const l2 = toolLen;
  let d = Math.hypot(lx, ly);
  const dd = Math.min(l1 + l2 - 0.5, Math.max(Math.abs(l1 - l2) + 0.5, d));
  const base = Math.atan2(ly, lx);
  const cosG = (l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd);
  const g = Math.acos(Math.max(-1, Math.min(1, cosG)));
  const rad = Math.PI / 180;
  let best = null;
  for (const sgn of [1, -1]) {
    const phi1 = base + sgn * g; // direction of the upper link
    const hx = Math.cos(phi1) * l1;
    const hy = Math.sin(phi1) * l1;
    const phi2 = Math.atan2(ly * (dd / (d || 1)) - hy, lx * (dd / (d || 1)) - hx); // direction of the tool
    const arm = phi1 / rad - 90; // arm hangs along +y at rot 0
    const prop = phi2 / rad - arm;
    const norm = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
    const sol = { arm: norm(arm), prop: norm(prop) };
    const score = Math.abs(norm(phi2 / rad - prefer));
    if (!best || score < best.score) best = { ...sol, score };
  }
  return { arm: best.arm, prop: best.prop };
}

/**
 * Sweep a held tool's tip along a path. The path is sampled every `step` ms; for each sample reach() solves
 * the arm and tool angles and the cue keyframes are emitted on c.armF, c.propF (and c.root.x when `stand`
 * is given). A short `lead` ease brings the arm to the start pose first. Returns the sampled tip points
 * `[{ t, x, y }]` (absolute ms) so scenes can put sparks, smoke and arc flashes exactly on the line.
 *
 *   aimAlong(thief, at(300), 1800, (s) => ({ x: 664, y: 590 - 200 * s }), { toolLen: TORCH_TIP.x, stand: () => 560 });
 *
 * path(s) -> { x, y } for s in 0..1 (world coords); stand(s) -> root x while sweeping (default: stay put).
 */
export function aimAlong(c, at, dur, path, { toolLen, stand, step = 120, prefer = 10, lead = 220, reduce } = {}) {
  const n = Math.max(2, Math.round(dur / step));
  const x0 = c.root.p.x;
  const rootX = (s) => (stand ? stand(s) : x0);
  const unwrap = (prev, a) => {
    let v = a;
    while (v - prev > 180) v -= 360;
    while (v - prev < -180) v += 360;
    return v;
  };
  const solve = (s) => {
    const p = path(s);
    return { p, ...reach(c, p.x, p.y, toolLen, prefer, { x: rootX(s) }) };
  };
  const first = solve(0);
  if (lead > 0) {
    c.armF.to(at - lead, lead, { rot: unwrap(c.armF.p.rot, first.arm) }, { ease: 'ease-in-out', reduce });
    c.propF.to(at - lead, lead, { rot: unwrap(c.propF.p.rot, first.prop) }, { ease: 'ease-in-out', reduce });
    if (stand && rootX(0) !== x0) c.root.to(at - lead, lead, { x: rootX(0) }, { ease: 'ease-in-out', reduce: 'snap' });
  }
  let pa = c.armF.p.rot;
  let pp = c.propF.p.rot;
  const fa = [];
  const fp = [];
  const fr = [];
  const tips = [{ t: at, x: first.p.x, y: first.p.y }];
  for (let i = 1; i <= n; i++) {
    const s = i / n;
    const r = solve(s);
    pa = unwrap(pa, r.arm);
    pp = unwrap(pp, r.prop);
    fa.push({ o: s, rot: pa });
    fp.push({ o: s, rot: pp });
    if (stand) fr.push({ o: s, x: rootX(s) });
    tips.push({ t: at + dur * s, x: r.p.x, y: r.p.y });
  }
  c.armF.keys(at, dur, fa, { ease: 'linear', reduce });
  c.propF.keys(at, dur, fp, { ease: 'linear', reduce });
  if (stand) c.root.keys(at, dur, fr, { ease: 'linear', reduce: 'snap' });
  return tips;
}

/** Sign pops into existence at (x, y) with a little overshoot. */
export function popIn(sign, at, x, y) {
  sign.track.set(at - 1, { x, y, sx: 0, sy: 0 });
  sign.track.keys(at, 280, [{ o: 0.6, sx: 1.14, sy: 1.14, ease: 'ease-out' }, { o: 1, sx: 1, sy: 1 }], { ease: 'linear' });
}

/**
 * Scene-definition helpers bound to one film's TIMING and CAPTION tables (config.js).
 *
 *   const { titleCard, shot } = filmHelpers({ TIMING, CAPTION });
 *   titleCard('lonely', TEXT.lonely)                      // fades through black
 *   titleCard('thatMine', TEXT.thatMine, { dialogue: true }) // cuts in and out like a spoken line
 *   shot('trudge', discovery.trudge, { in: 'iris', irisIn: [50, 62] })
 *
 * Both read `duration` and `caption` from TIMING[id] / CAPTION[id]; the scene id becomes
 * `c-<id>` (card) or `s-<id>` (shot). `extra` is merged last, so it can override any scene field.
 */
export function filmHelpers({ TIMING, CAPTION }) {
  /** Largest serif size that keeps the longest line inside the card border. */
  const fit = (lines) => {
    const longest = Math.max(...lines.map((l) => l.length));
    return Math.max(40, Math.min(96, Math.floor((1040 / longest - 4) / 0.66)));
  };

  /** A title-card scene. `o` goes to card() ({ size, kind, sub, dy }) plus `dialogue`. */
  const titleCard = (id, lines, o = {}, extra = {}) => {
    const size = o.size || fit(lines);
    const items = lines.map((t) => (typeof t === 'string' ? { t, size } : t));
    return {
      id: `c-${id}`,
      label: lines.map((l) => (typeof l === 'string' ? l : l.t)).join(' '),
      duration: TIMING[id],
      caption: CAPTION[id],
      in: o.dialogue ? 'cut' : 'fade',
      out: o.dialogue ? 'cut' : 'fade',
      inMs: 300,
      outMs: 300,
      build: (ctx) => card(ctx, items, o),
      ...extra,
    };
  };

  /** A live-action (well, live-cartoon) scene. */
  const shot = (id, build, extra = {}) => ({ id: `s-${id}`, label: id, duration: TIMING[id], caption: CAPTION[id], build, ...extra });

  return { titleCard, shot, fit };
}
