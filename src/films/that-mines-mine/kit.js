/**
 * Small helpers shared by the scene files.
 */
import { Track } from '../../acting.js';
import { tween } from '../../acting.js';

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

/** Slow cloud drift for the length of a scene. */
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

/** Sign pops into existence at (x, y) with a little overshoot. */
export function popIn(sign, at, x, y) {
  sign.track.set(at - 1, { x, y, sx: 0, sy: 0 });
  sign.track.keys(at, 280, [{ o: 0.6, sx: 1.14, sy: 1.14, ease: 'ease-out' }, { o: 1, sx: 1, sy: 1 }], { ease: 'linear' });
}
