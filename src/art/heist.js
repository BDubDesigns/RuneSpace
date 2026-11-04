/**
 * Story props for the "criminal fence" setup: the newspaper, the thought bubble, the shady dealer, Credits.
 *
 *   newspaper({ w, h, lines, back })   a front page (or just its back when `back`), origin = centre
 *   bubble(id, w, h)                    thought bubble with a tail of circles toward -x,+y; origin = bubble centre.
 *                                       tail circles are `${id}.t0|t1|t2`, the cloud is `${id}.cloud`
 *   dealer(id)                          trench-coated dealer with a FENCE sign. Origin = ground centre.
 *                                       `${id}.arm` (outstretched hand), `${id}.eyes`, smoke from `${id}.cig`
 *   coin(s)                             one Credit coin, origin = centre
 *   creditPile(seed, w, h)              a mound of Credits, origin = ground centre
 *   creditBag(s)                        a fat money sack marked C, origin = bottom centre
 */
import { INK } from './props.js';
import { emerald } from './emerald.js';
import { rng } from '../fx/effects.js';

const S = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;
const SERIF = "'Playfair Display','Bodoni MT',Didot,Georgia,'Times New Roman',serif";

/* ---------------------------------------------------------------- credits */

export function coin(s = 1) {
  return `<g transform="scale(${s})"><circle r="15" fill="#e6e6e6" ${S} stroke-width="3.4"/><circle r="10.5" fill="none" stroke="#777" stroke-width="1.8"/>
    <path d="M5 -5 A7 7 0 1 0 5 5" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/><path d="M-9 -9 Q-4 -13 2 -12" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></g>`;
}

/** Mound of coins. ~w wide (default 360), ~h tall (default 200). */
export function creditPile(seed = 5, w = 360, h = 200) {
  const rand = rng(seed);
  const rows = 9;
  let s = `<path d="M${-w / 2} 0 C${-w * 0.42} ${-h * 0.4} ${-w * 0.2} ${-h * 0.9} 0 ${-h} C${w * 0.2} ${-h * 0.9} ${w * 0.42} ${-h * 0.4} ${w / 2} 0Z" fill="#7a7a7a" ${S} stroke-width="5"/>`;
  for (let r = 0; r < rows; r++) {
    const y = -8 - (r / (rows - 1)) * (h - 30);
    const span = (w / 2 - 14) * (1 - r / rows) * (1 - (r / rows) * 0.25);
    const n = Math.max(1, Math.round((span * 2) / 26));
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : (i / (n - 1) - 0.5) * span * 2 + (rand() - 0.5) * 8;
      s += `<g transform="translate(${x.toFixed(0)} ${(y + (rand() - 0.5) * 8).toFixed(0)}) rotate(${((rand() - 0.5) * 50).toFixed(0)})">${coin(1.2 + rand() * 0.35)}</g>`;
    }
  }
  return `<g>${s}</g>`;
}

export function creditBag(s = 1) {
  return `<g transform="scale(${s})">
    <path d="M-22 -92 Q-12 -76 -30 -70 Q-70 -48 -66 -14 Q-60 4 0 4 Q60 4 66 -14 Q70 -48 30 -70 Q12 -76 22 -92Z" fill="#cfcfcf" ${S} stroke-width="5"/>
    <path d="M-34 -62 Q0 -50 34 -62" fill="none" ${S} stroke-width="4"/>
    <path d="M-26 -92 Q0 -102 26 -92 L22 -80 Q0 -74 -22 -80Z" fill="#9c9c9c" ${S} stroke-width="4"/>
    <circle cx="0" cy="-28" r="22" fill="none" ${S} stroke-width="5"/><path d="M10 -40 A16 16 0 1 0 10 -16" fill="none" ${S} stroke-width="6"/>
    <path d="M-48 -44 Q-56 -26 -46 -12" fill="none" stroke="#fff" stroke-width="5" opacity=".7"/>
  </g>`;
}

/* ---------------------------------------------------------------- newspaper */

/**
 * @param o { w, h, lines: { name, head: [l1, l2], sub: [l1, l2] }, back }
 * Origin = centre of the sheet. `back` draws only grey columns (the side the reader sees from behind).
 */
export function newspaper({ w = 880, h = 1080, lines = {}, back = false, id = 'np' } = {}) {
  const L = -w / 2;
  const T = -h / 2;
  const cols = (x0, y0, x1, y1, n, step = 17) => {
    let s = '';
    const rand = rng(Math.round(x0 + y0 + 7));
    for (let y = y0; y < y1; y += step) {
      for (let c = 0; c < n; c++) {
        const cw = (x1 - x0) / n - 10;
        const x = x0 + c * ((x1 - x0) / n);
        s += `<path d="M${x} ${y} L${x + cw * (0.72 + rand() * 0.28)} ${y}" stroke="#555" stroke-width="5" stroke-linecap="round" opacity=".6"/>`;
      }
    }
    return s;
  };
  const sheet = `<rect x="${L + 10}" y="${T + 12}" width="${w}" height="${h}" fill="#7d7d7d" opacity=".5"/>
    <rect x="${L}" y="${T}" width="${w}" height="${h}" fill="#f1efe9" ${S} stroke-width="6"/>
    <path d="M0 ${T} L0 ${T + h}" stroke="#d0d0d0" stroke-width="3"/>`;
  if (back) {
    return `<g>${sheet}${cols(L + 40, T + 120, L + w - 40, T + h - 60, 5, 15)}
      <rect x="${L + 40}" y="${T + 36}" width="${w - 80}" height="62" fill="#3a3a3a"/>
      <rect x="${L + 60}" y="${T + h * 0.46}" width="${w * 0.4}" height="${h * 0.2}" fill="#d0d0d0" ${S} stroke-width="3"/></g>`;
  }
  const head = lines.head || ['THE NEBULA HEART', 'EMERALD!'];
  const sub = lines.sub || ['ON DISPLAY FOR', 'ONE WEEK ONLY!'];
  return `<g>${sheet}
    <text x="0" y="${T + 88}" font-size="64" font-weight="900" text-anchor="middle" fill="${INK}" font-family="${SERIF}" font-style="italic" letter-spacing="3">${lines.name || 'THE DAILY NOVA'}</text>
    <path d="M${L + 30} ${T + 108} L${L + w - 30} ${T + 108}" stroke="${INK}" stroke-width="6"/><path d="M${L + 30} ${T + 120} L${L + w - 30} ${T + 120}" stroke="${INK}" stroke-width="2"/>
    <text x="${L + 34}" y="${T + 146}" font-size="17" fill="#333" font-family="${SERIF}">VOL. CCXLVII  ·  LATE EDITION</text><text x="${L + w - 34}" y="${T + 146}" font-size="17" text-anchor="end" fill="#333" font-family="${SERIF}">ONE CREDIT</text>
    <text x="0" y="${T + 244}" font-size="76" font-weight="900" text-anchor="middle" fill="${INK}" font-family="${SERIF}" letter-spacing="2">${head[0]}</text>
    <text x="0" y="${T + 346}" font-size="132" font-weight="900" text-anchor="middle" fill="${INK}" font-family="${SERIF}" letter-spacing="4">${head[1]}</text>
    <path d="M${L + 30} ${T + 372} L${L + w - 30} ${T + 372}" stroke="${INK}" stroke-width="3"/>
    <g data-t="${id}.banner"><rect x="${L + 120}" y="${T + 392}" width="${w - 240}" height="104" rx="4" fill="${INK}"/>
      <text x="0" y="${T + 440}" font-size="42" font-weight="900" text-anchor="middle" fill="#f4f4f4" font-family="${SERIF}" letter-spacing="4">${sub[0]}</text>
      <text x="0" y="${T + 482}" font-size="42" font-weight="900" text-anchor="middle" fill="#f4f4f4" font-family="${SERIF}" letter-spacing="4">${sub[1]}</text></g>
    <rect x="${L + 60}" y="${T + 520}" width="${w - 120}" height="${h - 640}" fill="#e0ded8" ${S} stroke-width="4"/>
    <g transform="translate(0 ${T + h - 138}) scale(0.78)">${emerald(`${id}.gem`, { w: 300, h: 360 })}</g>
    <path d="M${L + 110} ${T + h - 150} l12 -22 l12 22 M${L + w - 150} ${T + h - 210} l10 -20 l10 20" stroke="#222" stroke-width="3" fill="none" opacity=".5"/>
    ${cols(L + 70, T + h - 112, L + w - 70, T + h - 70, 3, 14)}
  </g>`;
}

/* ---------------------------------------------------------------- thought bubble */

export function bubble(id, w = 640, h = 420, tail = null) {
  const rx = w / 2;
  const ry = h / 2;
  const lobes = 14;
  let d = '';
  const pts = [];
  for (let i = 0; i < lobes; i++) {
    const a0 = (i / lobes) * Math.PI * 2;
    pts.push([Math.cos(a0) * (rx - 30), Math.sin(a0) * (ry - 30)]);
  }
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % lobes];
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    const out = 1.16;
    d += `${i === 0 ? `M${p[0].toFixed(0)} ${p[1].toFixed(0)}` : ''} Q${(mx * out).toFixed(0)} ${(my * out).toFixed(0)} ${q[0].toFixed(0)} ${q[1].toFixed(0)}`;
  });
  const tl = tail || [[-rx * 0.62, ry + 26, 26], [-rx * 0.8, ry + 84, 18], [-rx * 0.92, ry + 128, 11]];
  return `<g>
    ${tl.map(([x, y, r], i) => `<g data-t="${id}.t${i}" style="transform-box:fill-box;transform-origin:center"><circle cx="${x}" cy="${y}" r="${r}" fill="#fff" ${S} stroke-width="5"/></g>`).join('')}
    <g data-t="${id}.cloud" style="transform-box:fill-box;transform-origin:center"><path d="${d}Z" fill="#fff" ${S} stroke-width="7"/></g>
  </g>`;
}

/* ---------------------------------------------------------------- the fence */

/** Shady dealer in a trench coat and low fedora, standing under a sign that says FENCE. */
export function dealer(id, label = 'FENCE') {
  return `<g>
    <ellipse cx="0" cy="4" rx="64" ry="11" fill="#000" opacity=".3"/>
    <path d="M-26 0 L-26 -40 M26 0 L26 -40" ${S} stroke-width="22"/><path d="M-26 0 L-26 -40 M26 0 L26 -40" stroke="#444" stroke-width="12"/>
    <path d="M-40 -2 L-24 -2 L-24 6 L-44 6Z M24 -2 L44 -2 L44 6 L24 6Z" fill="#111" ${S} stroke-width="3"/>
    <path d="M-52 -34 L-44 -150 Q0 -176 44 -150 L52 -34 Q0 -24 -52 -34Z" fill="#555" ${S} stroke-width="5.6"/>
    <path d="M-12 -158 L0 -80 L12 -158 L30 -150 L0 -46 L-30 -150Z" fill="#2a2a2a" ${S} stroke-width="3.6"/>
    <path d="M-44 -34 L-40 -120 M44 -34 L40 -120" stroke="#8a8a8a" stroke-width="3" opacity=".7"/>
    <rect x="-8" y="-100" width="16" height="12" fill="#bbb" ${S} stroke-width="2.6"/>
    <g transform="translate(0 -52)"><path d="M-46 -4 L46 -4" ${S} stroke-width="9"/><path d="M-46 -4 L46 -4" stroke="#222" stroke-width="4"/><rect x="-9" y="-12" width="18" height="16" rx="2" fill="#d0d0d0" ${S} stroke-width="3"/></g>
    <g data-t="${id}.armB" transform="translate(-44 -120)"><g><path d="M0 0 Q-14 22 -8 50" fill="none" ${S} stroke-width="20"/><path d="M0 0 Q-14 22 -8 50" fill="none" stroke="#555" stroke-width="10"/><circle cx="-8" cy="54" r="11" fill="#e8e8e8" ${S} stroke-width="3.6"/></g></g>
    <g data-t="${id}.arm" transform="translate(44 -122)"><g>
      <path d="M0 0 Q28 8 52 -4" fill="none" ${S} stroke-width="20"/><path d="M0 0 Q28 8 52 -4" fill="none" stroke="#555" stroke-width="10"/>
      <path d="M52 -14 Q70 -22 78 -12 Q82 -2 66 4 L52 6Z" fill="#e8e8e8" ${S} stroke-width="3.6"/><path d="M62 -14 L66 -2 M70 -12 L72 0" stroke="#777" stroke-width="2"/></g></g>
    <g transform="translate(0 -176)">
      <ellipse cx="0" cy="8" rx="30" ry="34" fill="#1e1e1e" ${S} stroke-width="4"/>
      <g data-t="${id}.eyes"><path d="M-17 4 L-6 8 L-6 12 L-18 9Z M17 4 L6 8 L6 12 L18 9Z" fill="#fff"/></g>
      <path d="M-14 32 Q0 38 14 32" fill="none" stroke="#fff" stroke-width="3" opacity=".5"/>
      <g data-t="${id}.cig"><path d="M12 28 L40 30" stroke="#f0f0f0" stroke-width="7" stroke-linecap="round"/><circle cx="43" cy="30" r="4" fill="#fff" ${S} stroke-width="2"/></g>
      <ellipse cx="0" cy="-12" rx="56" ry="10" fill="#222" ${S} stroke-width="5"/>
      <path d="M-30 -12 C-34 -46 34 -46 30 -12Z" fill="#303030" ${S} stroke-width="5"/>
      <path d="M-31 -22 Q0 -12 31 -22 L30 -14 Q0 -4 -30 -14Z" fill="#999" ${S} stroke-width="3"/>
    </g>
    <g transform="translate(0 -262)"><path d="M0 24 L0 66" stroke="${INK}" stroke-width="7"/><path d="M0 24 L0 66" stroke="#999" stroke-width="3"/>
      <rect x="-86" y="-24" width="172" height="48" rx="6" fill="#f6f6f6" ${S} stroke-width="6"/>
      <text y="14" font-size="38" font-weight="900" text-anchor="middle" fill="${INK}" font-family="Impact, 'Arial Black', sans-serif" letter-spacing="8">${label}</text></g>
  </g>`;
}
