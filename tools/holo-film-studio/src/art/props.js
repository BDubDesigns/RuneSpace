/**
 * Reusable prop art (SVG strings). Every prop is drawn around a meaningful
 * local origin so it can be placed and rotated by a Track:
 *   cutter  – origin at the grip, barrel points +x
 *   mallet  – origin at the grip, head points up (-y)
 *   sign    – origin at the stake tip
 *   cart    – origin at the rail, under the middle of the cart
 *   ore*    – origin at the centre of the stone
 */
import { Track } from '../acting.js';
import { rng } from '../fx/effects.js';

export const INK = '#0d0d0d';
const S = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;

/* ------------------------------------------------------------------ ore */

/** A single piece of ore: faceted gem / crystal / glittering lump. Origin = centre, ~34px. */
export function ore(variant = 0, s = 1, tone = 1) {
  const k = variant % 3;
  const hi = tone > 0.5 ? '#ffffff' : '#e8e8e8';
  let body;
  if (k === 0) {
    body = `<path d="M-17 -5 L-8 -17 L8 -17 L17 -5 L0 18Z" fill="#cfcfcf" ${S} stroke-width="3.4"/>
      <path d="M-8 -17 L-3 -5 L3 -5 L8 -17Z" fill="${hi}"/>
      <path d="M-17 -5 L-3 -5 L0 18Z" fill="#a9a9a9"/><path d="M17 -5 L3 -5 L0 18Z" fill="#6e6e6e"/>
      <path d="M-17 -5 L-8 -17 L8 -17 L17 -5 L0 18Z M-3 -5 L0 18 L3 -5" fill="none" ${S} stroke-width="2.4"/>`;
  } else if (k === 1) {
    body = `<path d="M-16 14 L-12 -6 L-7 -22 L-1 -4 L5 -26 L10 -2 L15 -14 L17 14Z" fill="#dcdcdc" ${S} stroke-width="3.4"/>
      <path d="M5 -26 L10 -2 L5 14 L-1 -4Z" fill="#8a8a8a"/><path d="M-7 -22 L-1 -4 L-5 14 L-12 -6Z" fill="${hi}"/>
      <path d="M-16 14 L-12 -6 L-7 -22 L-1 -4 L5 -26 L10 -2 L15 -14 L17 14Z" fill="none" ${S} stroke-width="3.4"/>`;
  } else {
    body = `<path d="M-18 8 L-14 -9 L-3 -16 L12 -13 L19 -1 L14 12 L-4 16Z" fill="#5c5c5c" ${S} stroke-width="3.4"/>
      <path d="M-9 -5 L-4 -11 L2 -4 L-4 0Z M6 2 L11 -3 L14 4 L8 8Z" fill="#fff" ${S} stroke-width="1.8"/>
      <path d="M-14 6 L-8 2 M3 10 L8 6" ${S} stroke="#ddd" stroke-width="2"/>`;
  }
  return `<g transform="scale(${s})">${body}</g>`;
}

/* ---------------------------------------------------------- hand tools */

/** The mining cutter: boxy hand tool with a toothed cutting disc. Grip at origin, nose toward +x. */
export function cutter(id) {
  const teeth = [...Array(12)]
    .map((_, i) => {
      const a0 = (i / 12) * Math.PI * 2;
      const a1 = ((i + 0.5) / 12) * Math.PI * 2;
      const a2 = ((i + 1) / 12) * Math.PI * 2;
      const p = (a, rad) => `${(Math.cos(a) * rad).toFixed(1)},${(Math.sin(a) * rad).toFixed(1)}`;
      return `${p(a0, 22)} ${p(a1, 33)} ${p(a2 - 0.08, 22)}`;
    })
    .join(' ');
  return `<g>
    <path d="M-4 6 L-10 42 Q-10 50 -2 50 L10 50 Q16 50 14 42 L10 6Z" fill="#3b3b3b" ${S} stroke-width="5"/>
    <path d="M-6 20 L12 20 M-7 30 L12 30 M-8 40 L13 40" ${S} stroke="#777" stroke-width="2.4"/>
    <rect x="-16" y="-24" width="96" height="40" rx="9" fill="#bdbdbd" ${S} stroke-width="5.5"/>
    <rect x="-16" y="-24" width="96" height="12" rx="6" fill="#efefef" opacity=".8"/>
    <path d="M30 -24 L52 -24 L36 16 L14 16Z" fill="#161616"/>
    <path d="M36 -24 L42 -24 L26 16 L20 16Z M48 -24 L54 -24 L38 16 L32 16Z" fill="#f2f2f2"/>
    <rect x="30" y="-24" width="0" height="0"/>
    <rect x="-16" y="-24" width="96" height="40" rx="9" fill="none" ${S} stroke-width="5.5"/>
    <circle cx="-2" cy="-8" r="6" fill="#fff" ${S} stroke-width="3"/><path d="M-2 -8 L1 -12" ${S} stroke-width="2.4"/>
    <text x="66" y="3" font-size="9" font-weight="900" fill="${INK}" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" transform="rotate(-90 66 0)">CUTTER</text>
    <path d="M80 -14 L96 -14 L96 6 L80 6Z" fill="#6a6a6a" ${S} stroke-width="4.5"/>
    <g transform="translate(112 -4)"><g data-t="${id}.disc">
      <polygon points="${teeth}" fill="#e6e6e6" ${S} stroke-width="4.5"/>
      <circle r="15" fill="#9c9c9c" ${S} stroke-width="3.6"/>
      <path d="M-15 0 L15 0 M0 -15 L0 15" ${S} stroke-width="3"/><circle r="4.5" fill="${INK}"/>
    </g></g>
  </g>`;
}

/** Stake mallet: grip at origin, head toward +y (so an overhead raise points it up and away). */
export function mallet() {
  return `<g>
    <rect x="-6" y="-14" width="12" height="92" rx="5" fill="#a3a3a3" ${S} stroke-width="5"/>
    <rect x="-32" y="62" width="64" height="38" rx="8" fill="#6e6e6e" ${S} stroke-width="5.5"/>
    <rect x="-32" y="62" width="64" height="11" rx="5.5" fill="#bdbdbd" opacity=".8"/>
    <path d="M-19 62 L-19 100 M19 62 L19 100" ${S} stroke="#222" stroke-width="5"/>
  </g>`;
}

/* ----------------------------------------------------------------- sign */

/** "MINE!" claim sign on a stake. variant 'pip' = plain board, 'rex' = fancy dark board. */
export function sign(variant = 'pip', text = 'MINE!') {
  const stake = `<polygon points="-7,-150 7,-150 7,-22 0,2 -7,-22" fill="#b4b4b4" ${S} stroke-width="5"/>
    <path d="M-2 -140 L-2 -30 M3 -120 L3 -60" ${S} stroke="#7d7d7d" stroke-width="2"/>`;
  if (variant === 'rex') {
    return `<g>${stake}<g transform="translate(0 -10) rotate(2)">
      <rect x="-76" y="-176" width="152" height="68" rx="6" fill="#1b1b1b" ${S} stroke-width="5.5"/>
      <rect x="-68" y="-168" width="136" height="52" rx="3" fill="none" stroke="#f4f4f4" stroke-width="2.4"/>
      <text y="-129" font-size="42" font-weight="900" text-anchor="middle" fill="#f6f6f6" letter-spacing="3" font-family="Georgia, 'Times New Roman', serif" font-style="italic">${text}</text>
      <path d="M-50 -122 Q0 -112 50 -122" fill="none" stroke="#f4f4f4" stroke-width="2.4"/>
      <circle cx="-62" cy="-150" r="3.2" fill="#f4f4f4"/><circle cx="62" cy="-150" r="3.2" fill="#f4f4f4"/>
    </g></g>`;
  }
  return `<g>${stake}<g transform="translate(0 -10) rotate(-3)">
    <rect x="-70" y="-168" width="140" height="62" rx="4" fill="#f1f1f1" ${S} stroke-width="5.5"/>
    <path d="M-62 -158 L-62 -116 M62 -158 L62 -116" stroke="#cfcfcf" stroke-width="3"/>
    <text y="-123" font-size="44" font-weight="900" text-anchor="middle" fill="${INK}" letter-spacing="1" font-family="'Courier New', Courier, monospace">${text}</text>
    <circle cx="-58" cy="-160" r="3.4" fill="#444"/><circle cx="58" cy="-160" r="3.4" fill="#444"/>
    <circle cx="-58" cy="-114" r="3.4" fill="#444"/><circle cx="58" cy="-114" r="3.4" fill="#444"/>
  </g></g>`;
}

/* ----------------------------------------------------------------- cart */

const LOAD_SPOTS = (() => {
  // An absurd, slightly leaning tower of ore on the cart rim (origin = middle of the rim),
  // plus a few stones clinging to the sides. The last spot is the crowning stone.
  const rows = [
    { y: -8, n: 7, w: 138 },
    { y: -46, n: 6, w: 118 },
    { y: -84, n: 5, w: 98 },
    { y: -122, n: 4, w: 80 },
    { y: -158, n: 4, w: 66 },
    { y: -194, n: 3, w: 50 },
    { y: -228, n: 3, w: 36 },
    { y: -260, n: 2, w: 22 },
    { y: -290, n: 2, w: 14 },
    { y: -318, n: 1, w: 0 },
  ];
  const spots = [];
  const rand = rng(11);
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const x = row.n === 1 ? 0 : (i / (row.n - 1) - 0.5) * row.w * 2;
      spots.push({ x: x + -row.y * 0.1 + (rand() - 0.5) * 8, y: row.y + (rand() - 0.5) * 6, s: 1.3 + rand() * 0.3 + (row.y > -130 ? 0.2 : 0) });
    }
  }
  const top = spots.pop();
  spots.push({ x: -108, y: 6, s: 1.3 }, { x: 108, y: 4, s: 1.3 }, { x: -96, y: -30, s: 1.1 }, { x: 98, y: -34, s: 1.1 }, top);
  return spots;
})();
export const CART_LOAD_COUNT = LOAD_SPOTS.length;
/** Index of the crowning stone (always the last one placed). */
export const CART_TOP = LOAD_SPOTS.length - 1;
export const cartSpot = (i) => LOAD_SPOTS[i];

/**
 * Mine cart. Returns markup; chunk i is `${id}.ch${i}` (starts scaled to 0), wheels are
 * `${id}.whB` / `${id}.whF`, the whole body+load can squash via `${id}.body`.
 */
export function cart(id, { loaded = 0 } = {}) {
  const chunks = LOAD_SPOTS.map((p, i) => {
    const on = i < loaded;
    return `<g data-t="${id}.ch${i}" style="transform:translate(${p.x}px, ${p.y}px) scale(${on ? 1 : 0})">${ore(i, p.s)}</g>`;
  }).join('');
  const wheel = (key, x) => `<g transform="translate(${x} -25)"><g data-t="${id}.${key}">
      <circle r="26" fill="#2c2c2c" ${S} stroke-width="5.5"/><circle r="17" fill="#bcbcbc" ${S} stroke-width="3.6"/>
      <path d="M-17 0 L17 0 M0 -17 L0 17 M-12 -12 L12 12 M12 -12 L-12 12" ${S} stroke-width="3"/><circle r="6" fill="${INK}"/>
    </g></g>`;
  return `<g>
    <path d="M-110 -44 L-80 -44" ${S} stroke-width="8"/><circle cx="-112" cy="-44" r="7" fill="#999" ${S} stroke-width="4"/>
    ${wheel('whB', -48)}
    <g data-t="${id}.body">
      <g transform="translate(0 -104)">${chunks}</g>
      <path d="M-88 -108 L88 -108 L70 -46 L-70 -46Z" fill="#8f8f8f" ${S} stroke-width="6"/>
      <path d="M-82 -88 L82 -88 M-76 -66 L76 -66" ${S} stroke="#4c4c4c" stroke-width="4"/>
      <path d="M-86 -106 L-72 -50 L-60 -50 L-74 -106Z" fill="#b3b3b3" opacity=".65"/>
      <rect x="-96" y="-120" width="192" height="16" rx="6" fill="#525252" ${S} stroke-width="5.5"/>
      <rect x="-96" y="-120" width="192" height="5" rx="2.5" fill="#bdbdbd" opacity=".7"/>
      ${[-70, -35, 0, 35, 70].map((x) => `<circle cx="${x}" cy="-77" r="3.4" fill="#d6d6d6" ${S} stroke-width="1.6"/>`).join('')}
      <path d="M-14 -66 l5 -12 l5 12 l-13 -8 l16 0z" fill="#e8e8e8"/>
    </g>
    ${wheel('whF', 48)}
  </g>`;
}

/* ----------------------------------------------------------- ore pile */

/** Big mound of ore, origin at ground centre, ~460 wide x ~250 tall. */
export function orePile(seed = 3) {
  const rand = rng(seed);
  const mound = `<path d="M-250 0 C-230 -40 -190 -70 -140 -100 C-100 -150 -60 -200 0 -222 C60 -200 100 -150 140 -100 C190 -70 230 -40 250 0Z" fill="#6a6a6a" ${S} stroke-width="6"/>`;
  const rows = [
    { y: -12, n: 11, w: 215 },
    { y: -46, n: 9, w: 180 },
    { y: -82, n: 7, w: 140 },
    { y: -120, n: 5, w: 100 },
    { y: -156, n: 4, w: 66 },
    { y: -186, n: 2, w: 28 },
    { y: -208, n: 1, w: 0 },
  ];
  let chunks = '';
  let i = 0;
  for (const row of rows) {
    for (let k = 0; k < row.n; k++, i++) {
      const x = row.n === 1 ? 0 : (k / (row.n - 1) - 0.5) * row.w * 2;
      chunks += `<g transform="translate(${(x + (rand() - 0.5) * 10).toFixed(0)} ${(row.y + (rand() - 0.5) * 8).toFixed(0)}) rotate(${((rand() - 0.5) * 40).toFixed(0)})">${ore(i, 1.35 + rand() * 0.45)}</g>`;
    }
  }
  return `<g>${mound}${chunks}</g>`;
}

/* ---------------------------------------------------------------- rocks */

export function boulder(w = 130, h = 96) {
  return `<g>
    <path d="M${-w / 2} 0 C${-w / 2 - 6} ${-h * 0.5} ${-w * 0.25} ${-h} ${w * 0.08} ${-h} C${w * 0.38} ${-h} ${w / 2 + 6} ${-h * 0.4} ${w / 2} 0Z" fill="#6d6d6d" ${S} stroke-width="6"/>
    <path d="M${-w * 0.3} ${-h * 0.72} C${-w * 0.1} ${-h * 0.95} ${w * 0.15} ${-h * 0.95} ${w * 0.3} ${-h * 0.75}" fill="none" stroke="#bdbdbd" stroke-width="7" stroke-linecap="round"/>
    <path d="M${w * 0.15} ${-h * 0.5} l${w * 0.1} ${h * 0.3} M${-w * 0.2} ${-h * 0.35} l${-w * 0.05} ${h * 0.25}" ${S} stroke-width="3"/>
  </g>`;
}

/** Helper: a Track for a prop wrapper plus its markup, already posed. */
export function placed(cues, id, markup, pose = {}) {
  const t = new Track(cues, id, pose);
  return { track: t, html: `<g data-t="${id}" style="${t.css}">${markup}</g>` };
}
