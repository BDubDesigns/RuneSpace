/**
 * Balloons and a bird.
 *
 *   balloon(tone, s)   one balloon, origin = the knot (the body rises toward -y), so scaling Y about the
 *                      origin stretches it while the knot stays attached to its string
 *   scrap()            a limp popped balloon rag, origin = the knot
 *   bird(id)           a tiny bird in flight, facing +x, origin = body centre. Wings: `${id}.wA` / `${id}.wB`,
 *                      head: `${id}.head`.
 */
import { INK } from './props.js';
import { Track } from '../acting.js';
import { popBurst, rng } from '../fx/effects.js';

const S = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;

const TONES = [
  { f: '#f6f6f6', s: '#d0d0d0' },
  { f: '#bdbdbd', s: '#8a8a8a' },
  { f: '#7d7d7d', s: '#4e4e4e' },
  { f: '#e0e0e0', s: '#b0b0b0', stripe: true },
  { f: '#4a4a4a', s: '#262626' },
];
export const BALLOON_TONES = TONES.length;

export function balloon(tone = 0, s = 1) {
  const t = TONES[tone % TONES.length];
  const stripes = t.stripe
    ? `<path d="M-20 -30 Q0 -22 20 -30 M-26 -52 Q0 -42 26 -52 M-22 -74 Q0 -66 22 -74" fill="none" stroke="#333" stroke-width="5"/>`
    : '';
  return `<g transform="scale(${s})">
    <path d="M0 0 C-44 -6 -40 -84 0 -98 C40 -84 44 -6 0 0Z" fill="${t.f}" ${S} stroke-width="4.4"/>
    <path d="M-2 0 C-30 -8 -34 -70 -6 -92 C20 -88 40 -50 24 -10 C16 -2 6 0 -2 0Z" fill="${t.s}" opacity=".55"/>
    ${stripes}
    <path d="M0 0 C-44 -6 -40 -84 0 -98 C40 -84 44 -6 0 0Z" fill="none" ${S} stroke-width="4.4"/>
    <path d="M-26 -62 Q-26 -80 -12 -86" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".9"/>
    <path d="M-7 3 L7 3 L0 -4Z" fill="${t.s}" ${S} stroke-width="3"/>
  </g>`;
}

export function scrap() {
  return `<path d="M0 0 Q-10 12 -4 22 Q4 16 8 26 Q12 10 4 2Z" fill="#9a9a9a" ${S} stroke-width="3"/>`;
}

export function bird(id) {
  return `<g>
    <g data-t="${id}.wB"><path d="M-2 -4 Q-22 -34 -40 -26 Q-24 -16 -22 -2Z" fill="#8a8a8a" ${S} stroke-width="3.2"/></g>
    <path d="M-26 2 L-44 -6 L-40 6 L-46 12 L-26 8Z" fill="#555" ${S} stroke-width="3.2"/>
    <ellipse cx="0" cy="0" rx="27" ry="19" fill="#f0f0f0" ${S} stroke-width="4"/>
    <path d="M-6 4 Q8 12 22 4 Q12 16 -2 14Z" fill="#c8c8c8"/>
    <g data-t="${id}.head"><circle cx="24" cy="-10" r="13" fill="#f0f0f0" ${S} stroke-width="4"/>
      <circle cx="28" cy="-13" r="5" fill="#fff" ${S} stroke-width="2.4"/><circle cx="29.6" cy="-13" r="2.2" fill="${INK}"/>
      <path d="M36 -12 L52 -8 L36 -3Z" fill="#9a9a9a" ${S} stroke-width="3"/>
      <path d="M16 -22 Q14 -32 22 -30" fill="none" ${S} stroke-width="3"/></g>
    <g data-t="${id}.wA"><path d="M2 -6 Q-12 -42 -34 -38 Q-18 -22 -16 -4Z" fill="#fff" ${S} stroke-width="3.4"/></g>
  </g>`;
}

/**
 * A cloud of balloons tied to a hub point. Everything is positioned in the HUB's local frame, so put
 * `cloud.html` inside whatever the balloons are lifting (it then moves, squashes and falls with it).
 *
 *   const cloud = new BalloonCloud(cues, id, { hub: { x, y }, count: 30, seed, minLen, maxLen, spread, placed });
 *                                  `placed: true` starts with every balloon already floating in place (a later scene)
 *   cloud.release(i, at)           balloon i is tied on: it pops in at the hub and floats up to its place (700 ms)
 *   cloud.releaseRange(a, b, at, gap)   tie on balloons a..b-1, one every `gap` ms from `at`
 *   cloud.stretch(at, dur, k)      all live balloons stretch up to k x (heavy load!)
 *   cloud.pop(i, at)               balloon i bursts (burst fx + a limp scrap left on the string)
 *   cloud.count / cloud.pos(i)     { x, y } of balloon i's knot (hub-relative)
 *   cloud.html                     markup (call after scheduling)
 */
export class BalloonCloud {
  constructor(cues, id, { hub = { x: 0, y: 0 }, count = 30, seed = 4, minLen = 120, maxLen = 380, spread = 190, placed = false } = {}) {
    this.cues = cues;
    this.id = id;
    this.hub = hub;
    this.count = count;
    this.live = new Set();
    this.bursts = '';
    const rand = rng(seed);
    this.items = [];
    if (placed) for (let i = 0; i < count; i++) this.live.add(i);
    for (let i = 0; i < count; i++) {
      // fan out in rings: later balloons float higher and wider
      const k = i / Math.max(1, count - 1);
      const len = minLen + (maxLen - minLen) * (0.15 + 0.85 * Math.sqrt(k)) * (0.85 + rand() * 0.3);
      const dx = (rand() - 0.5) * 2 * spread * (0.35 + 0.65 * Math.sqrt(k));
      const ang = Math.atan2(dx, len);
      const L = Math.hypot(dx, len);
      this.items.push({
        tone: Math.floor(rand() * BALLOON_TONES),
        s: 0.82 + rand() * 0.34,
        len: L,
        ang: (ang * 180) / Math.PI,
        kx: hub.x + dx,
        ky: hub.y - len,
        b: new Track(cues, `${id}.b${i}`, placed ? { x: hub.x + dx, y: hub.y - len, sx: 1, sy: 1 } : { x: hub.x, y: hub.y, sx: 0, sy: 0 }),
        str: new Track(cues, `${id}.s${i}`, { x: hub.x, y: hub.y, rot: (ang * 180) / Math.PI, sy: placed ? L : 0 }),
        scrap: new Track(cues, `${id}.r${i}`, { x: hub.x, y: hub.y, sx: 0, sy: 0 }),
      });
    }
  }

  pos(i) {
    const it = this.items[i];
    return { x: it.kx, y: it.ky };
  }

  release(i, at) {
    const it = this.items[i];
    it.b.keys(at, 260, [{ o: 1, sx: 1, sy: 1 }], { ease: 'cubic-bezier(.2,1.5,.4,1)' });
    it.b.to(at + 260, 560, { x: it.kx, y: it.ky }, { ease: 'ease-in-out' });
    it.str.to(at + 260, 560, { sy: it.len }, { ease: 'ease-in-out' });
    this.live.add(i);
  }

  /** Tie on balloons from..to-1, one every `gap` ms starting at `at`. */
  releaseRange(from, to, at, gap = 70) {
    for (let i = from; i < Math.min(to, this.count); i++) this.release(i, at + (i - from) * gap);
  }

  stretch(at, dur, k = 1.45) {
    this.live.forEach((i) => {
      const it = this.items[i];
      it.b.to(at, dur, { sy: k, sx: 0.9 }, { ease: 'ease-in-out', reduce: 'snap' });
    });
  }

  pop(i, at) {
    const it = this.items[i];
    this.live.delete(i);
    it.b.set(at, { sx: 0, sy: 0 });
    it.scrap.set(at, { x: it.kx, y: it.ky + 4, sx: 1, sy: 1 });
    it.scrap.to(at + 40, 900, { y: it.ky + 40, rot: 14 }, { ease: 'ease-in' });
    this.bursts += popBurst({ x: it.kx, y: it.ky - 46 * it.s, at, dur: 380, s: 0.9 * it.s, seed: 3 + (i % 5) });
  }

  get html() {
    const parts = this.items
      .map(
        (it, i) =>
          `<g data-t="${this.id}.s${i}" style="${it.str.css}"><path d="M0 0 L0 -1" stroke="#0d0d0d" stroke-width="2.4"/></g>` +
          `<g data-t="${this.id}.b${i}" style="${it.b.css}">${balloon(it.tone, it.s)}</g>` +
          `<g data-t="${this.id}.r${i}" style="${it.scrap.css}">${scrap()}</g>`
      )
      .join('');
    return `<g>${parts}${this.bursts}</g>`;
  }
}
