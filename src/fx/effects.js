/**
 * Reusable SVG effects. Each function returns an SVG markup string.
 *
 * Effects are CSS keyframe animations (see effects.css). Their timing is passed
 * in as custom properties (`--at`, `--dur`, ...), the same way RuneSpace feeds
 * `--rs-flight-dust` into its flight VFX. The movie timeline discovers them with
 * root.getAnimations() and drives them on the master clock, so they pause and
 * seek exactly like cued character animation.
 *
 * `at` is always ABSOLUTE film time in ms (use ctx.at(rel)).
 */

const v = (o) =>
  Object.entries(o)
    .map(([k, val]) => `--${k}:${typeof val === 'number' ? Math.round(val * 100) / 100 : val}`)
    .join(';');

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (x, y, inner, extra = '') => `<g transform="translate(${x} ${y})${extra}">${inner}</g>`;

/** One soft dust puff (radial gradient, never a hard edge). */
export function puff({ x, y, at: t, dur = 800, r = 34, dx = 0, dy = -26, opacity = 0.9, fill = 'url(#g-dust)' }) {
  return at(x, y, `<circle class="fx fx-puff" r="${r}" fill="${fill}" style="${v({ at: t, dur, dx, dy, o: opacity })}"/>`);
}

/** A rolling cloud of puffs at ground level. `dir` biases drift left (-1) or right (+1). */
export function dust({ x, y, at: t, n = 5, spread = 60, r = 30, dur = 900, dir = 0, seed = 1, fill }) {
  const rand = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2;
    const px = x + k * spread * (0.6 + rand() * 0.4);
    s += puff({
      x: px,
      y: y - rand() * 14,
      at: t + rand() * 140,
      dur: dur * (0.8 + rand() * 0.4),
      r: r * (0.7 + rand() * 0.6),
      dx: dir * (30 + rand() * 50) + (px - x) * 0.5,
      dy: -(18 + rand() * 30),
      fill,
    });
  }
  return s;
}

const SPARK = 'M0 -10 L2.6 -2.6 L10 0 L2.6 2.6 L0 10 L-2.6 2.6 L-10 0 L-2.6 -2.6Z';

/** Bright 4-point sparks flung from a point with a little gravity. */
export function sparks({ x, y, at: t, n = 10, power = 150, dur = 560, angle = -Math.PI / 2, spread = Math.PI * 0.9, seed = 2, size = 1 }) {
  const rand = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = angle + (rand() - 0.5) * spread;
    const p = power * (0.55 + rand() * 0.6);
    s += at(
      x,
      y,
      `<path class="fx fx-spark" d="${SPARK}" fill="#fff" stroke="#111" stroke-width="1.6" style="${v({
        at: t + rand() * 80,
        dur: dur * (0.8 + rand() * 0.5),
        dx: Math.cos(a) * p,
        dy: Math.sin(a) * p * 0.8,
        fall: 50 + rand() * 40,
        rot: (rand() - 0.5) * 540,
        s: size * (0.7 + rand() * 0.7),
      })}"/>`
    );
  }
  return s;
}

/** Dark rock chips for cutter / impact debris. */
export function chips({ x, y, at: t, n = 8, power = 130, dur = 700, angle = -Math.PI / 2, spread = Math.PI * 1.1, seed = 5, size = 1, fill = '#2a2a2a' }) {
  const rand = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = angle + (rand() - 0.5) * spread;
    const p = power * (0.5 + rand() * 0.7);
    s += at(
      x,
      y,
      `<path class="fx fx-spark" d="M-6 -3 L1 -7 L7 -1 L3 6 L-5 5Z" fill="${fill}" stroke="#f4f4f4" stroke-width="1.4" style="${v({
        at: t + rand() * 60,
        dur: dur * (0.8 + rand() * 0.5),
        dx: Math.cos(a) * p,
        dy: Math.sin(a) * p * 0.9,
        fall: 70 + rand() * 60,
        rot: (rand() - 0.5) * 720,
        s: size * (0.7 + rand() * 0.8),
      })}"/>`
    );
  }
  return s;
}

function starburstPoints(points, outer, inner, seed = 4) {
  const rand = rng(seed);
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner * (0.9 + rand() * 0.2) : outer * (0.9 + rand() * 0.2);
    const a = (i / (points * 2)) * Math.PI * 2;
    d += `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)} `;
  }
  return d.trim();
}

/** Comic impact word on a starburst: "BONK!", "CRASH!" ... */
export function pow({ x, y, at: t, text = 'BONK!', dur = 1000, rot = -8, scale = 1, font = 64 }) {
  return at(
    x,
    y,
    `<g class="fx fx-pow fx-keep" style="${v({ at: t, dur })}">
       <polygon points="${starburstPoints(15, 150, 96)}" fill="#fff" stroke="#111" stroke-width="7" stroke-linejoin="round"/>
       <text class="pow-text" y="${font * 0.34}" font-size="${font}" text-anchor="middle">${text}</text>
     </g>`,
    ` rotate(${rot}) scale(${scale})`
  );
}

/** Ring of expanding impact rays. */
export function rays({ x, y, at: t, n = 12, r0 = 30, r1 = 90, dur = 420, stroke = '#111', width = 6 }) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    s += `<line x1="${(Math.cos(a) * r0).toFixed(1)}" y1="${(Math.sin(a) * r0).toFixed(1)}" x2="${(Math.cos(a) * r1).toFixed(1)}" y2="${(Math.sin(a) * r1).toFixed(1)}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
  }
  return at(x, y, `<g class="fx fx-rays" style="${v({ at: t, dur })}">${s}</g>`);
}

/** Floating snore Zs. */
export function zzz({ x, y, at: t, dur = 2000 }) {
  let s = '';
  for (let i = 0; i < 3; i++) {
    const delay = i * 460;
    const n = Math.max(1, Math.ceil((dur - delay) / 1400));
    s += `<text class="fx fx-zzz fx-keep" x="${i * 18}" y="${-i * 6}" font-size="${34 + i * 12}" style="${v({ at: t + delay, dur: 1400, n })}">Z</text>`;
  }
  return at(x, y, s);
}

/** Dizzy stars orbiting in a flat ellipse (head-bonk classic). */
export function dizzy({ x, y, at: t, dur = 2000, rx = 52, ry = 13, count = 4 }) {
  const P = 1000; // orbit period
  let s = '';
  for (let i = 0; i < count; i++) {
    const ph = (i / count) * P;
    s += `<g class="fx-orbx" style="${v({ at: t, dur: P / 2, ph, rx })}"><g class="fx-orby" style="${v({ at: t, dur: P / 2, ph: ph + P / 4, ry })}">
      <path d="M0 -13 L4 -4 L13 -4 L6 2 L9 12 L0 6 L-9 12 L-6 2 L-13 -4 L-4 -4Z" fill="#fff" stroke="#111" stroke-width="2.4" stroke-linejoin="round"/></g></g>`;
  }
  return at(x, y, `<g class="fx fx-env fx-keep" style="${v({ at: t, dur })}">${s}</g>`);
}

/** Repeating glint on a gem or a cutter edge. */
export function sparkle({ x, y, at: t, dur = 1100, r = 16, n = 1, s = 1 }) {
  const p = `M0 ${-r} Q2.4 -2.4 ${r} 0 Q2.4 2.4 0 ${r} Q-2.4 2.4 ${-r} 0 Q-2.4 -2.4 0 ${-r}Z`;
  return at(x, y, `<path class="fx fx-glint" d="${p}" fill="#fff" stroke="#111" stroke-width="1.6" style="${v({ at: t, dur, n, s })}"/>`);
}

/** Streaks that trail a fast object. Place INSIDE the moving actor (local coords). */
export function speedLines({ x = 0, y = 0, at: t, dur = 400, total = 1200, n = 6, len = 130, dir = 1, spreadY = 80, seed = 3 }) {
  const rand = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const ly = (rand() - 0.5) * spreadY * 2;
    const l = len * (0.6 + rand() * 0.6);
    const reps = Math.max(1, Math.ceil(total / dur));
    s += `<line class="fx fx-speed" x1="0" y1="${ly.toFixed(0)}" x2="${(-dir * l).toFixed(0)}" y2="${ly.toFixed(0)}" stroke="#111" stroke-width="${3 + rand() * 3}" stroke-linecap="round" style="${v({
      at: t + rand() * dur,
      dur,
      n: reps,
      d: dir * 40,
    })}"/>`;
  }
  return at(x, y, s);
}

/** "!" or "?" popping over a head. */
export function mark({ x, y, at: t, text = '!', dur = 1000, size = 96 }) {
  return at(x, y, `<text class="fx fx-mark fx-keep" font-size="${size}" text-anchor="middle" style="${v({ at: t, dur })}">${text}</text>`);
}

/** Flying sweat drops. */
export function drops({ x, y, at: t, n = 3, dur = 700, seed = 7, spread = 70 }) {
  const rand = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    s += at(
      x,
      y,
      `<path class="fx fx-spark" d="M0 -9 Q8 3 0 9 Q-8 3 0 -9Z" fill="#fff" stroke="#111" stroke-width="2.2" style="${v({
        at: t + i * 90,
        dur,
        dx: side * (spread * (0.5 + rand() * 0.6)),
        dy: -(30 + rand() * 30),
        fall: 60,
        rot: side * 40,
        s: 1,
      })}"/>`
    );
  }
  return s;
}

/** The horned lightbulb of a Very Bad Idea. */
export function badIdea({ x, y, at: t, dur = 1600, scale = 1 }) {
  const rays = [...Array(10)]
    .map((_, i) => {
      const a = (i / 10) * Math.PI * 2;
      return `<line x1="${(Math.cos(a) * 64).toFixed(0)}" y1="${(Math.sin(a) * 64 - 8).toFixed(0)}" x2="${(Math.cos(a) * 88).toFixed(0)}" y2="${(Math.sin(a) * 88 - 8).toFixed(0)}"/>`;
    })
    .join('');
  return at(
    x,
    y,
    `<g class="fx fx-bulb fx-keep" style="${v({ at: t, dur })}">
       <g stroke="#111" stroke-width="5" stroke-linecap="round" fill="none">${rays}</g>
       <path d="M-30 -30 Q-52 -62 -34 -78 Q-34 -52 -14 -44Z M30 -30 Q52 -62 34 -78 Q34 -52 14 -44Z" fill="#111"/>
       <circle cx="0" cy="-8" r="38" fill="#fff" stroke="#111" stroke-width="6"/>
       <path d="M-16 32 L-16 46 L16 46 L16 32 Q0 38 -16 32Z" fill="#999" stroke="#111" stroke-width="5" stroke-linejoin="round"/>
       <path d="M-12 -2 L-6 -16 L0 -2 L6 -16 L12 -2" fill="none" stroke="#111" stroke-width="4" stroke-linejoin="round"/>
       <path d="M-14 -16 Q-6 -24 -2 -16 M14 -16 Q6 -24 2 -16" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round"/>
     </g>`,
    ` scale(${scale})`
  );
}

/** Full-frame white flash (impact frame). Place at scene root, outside the camera group. */
export function flash({ at: t, dur = 160, peak = 0.9, w = 1280, h = 720 }) {
  return `<rect class="fx fx-flash" width="${w}" height="${h}" fill="#fff" style="${v({ at: t, dur, o: peak })}"/>`;
}

/** Dark full-frame dip (e.g. dramatic beat before the bonk). */
export function dim({ at: t, dur = 600, peak = 0.35, w = 1280, h = 720 }) {
  return `<rect class="fx fx-flash" width="${w}" height="${h}" fill="#000" style="${v({ at: t, dur, o: peak })}"/>`;
}
