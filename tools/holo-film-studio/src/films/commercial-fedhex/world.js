/**
 * "FedHex" commercial - the bolt, the boxes, the stamps, the freighter and the wordmark.
 * Black-and-white cartoon art in the studio's house style; only the closing wordmark is in colour
 * (Fed purple, Hex orange), as the owner approved.
 */
import { FX_DEFS } from '../../fx/effects.js';
import { INK } from '../../art/props.js';

export const PURPLE = '#4d148c';
export const ORANGE = '#ff6200';
const SANS = "'Arial Black','Trebuchet MS',Impact,'DejaVu Sans',sans-serif";
const SERIF = "'Playfair Display','Bodoni MT',Didot,Georgia,'Times New Roman',serif";
const S = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;

export const GROUND_Y = 604;
export const BELT_Y = 560;

export const WORLD_DEFS = `${FX_DEFS}
  <linearGradient id="fh-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9e9e9"/><stop offset="1" stop-color="#bcbcbc"/></linearGradient>
  <linearGradient id="fh-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9c9c9c"/><stop offset="1" stop-color="#666"/></linearGradient>
  <linearGradient id="fh-space" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050505"/><stop offset="1" stop-color="#2a2a2a"/></linearGradient>
  <linearGradient id="fh-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101010"/><stop offset="1" stop-color="#6a6a6a"/></linearGradient>
  <radialGradient id="fh-moon" cx=".38" cy=".35" r=".75"><stop offset="0" stop-color="#fafafa"/><stop offset="1" stop-color="#9d9d9d"/></radialGradient>`;

const hex = (r) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
  }).join(' ');

/** The hexagonal "e" emblem. Colour (purple hexagon, orange e) or one-colour ink for a stamp. */
export function hexE(r = 60, { color = true, line = 5 } = {}) {
  const fill = color ? PURPLE : '#fff';
  const ink = color ? ORANGE : INK;
  return `<g><polygon points="${hex(r)}" fill="${fill}" stroke="${INK}" stroke-width="${line}" stroke-linejoin="round"/>
    <text y="${r * 0.36}" font-size="${r * 1.12}" font-weight="900" text-anchor="middle" fill="${ink}" font-family="${SANS}">e</text></g>`;
}

/** A hex-head bolt, drawn big because it is the star: head, washer face, shank, threads. */
export function bolt(s = 1) {
  return `<g transform="scale(${s})">
    <rect x="-9" y="2" width="18" height="46" rx="3" fill="#cfcfcf" ${S} stroke-width="4"/>
    <path d="M-9 14 L9 8 M-9 24 L9 18 M-9 34 L9 28 M-9 44 L9 38" ${S} stroke-width="3"/>
    <polygon points="${hex(20)}" transform="translate(0 -8) scale(1 0.78)" fill="#e9e9e9" ${S} stroke-width="4.5"/>
    <ellipse cx="0" cy="-12" rx="9" ry="6" fill="#fff" ${S} stroke-width="3"/>
  </g>`;
}

/** An ordinary cardboard box: centre-bottom origin, tape, flaps. */
export function parcel(w, h, { tape = true, slats = false } = {}) {
  const wood = slats
    ? Array.from({ length: Math.floor(w / 62) }, (_, i) => `<path d="M${-w / 2 + 62 * (i + 1)} ${-h} L${-w / 2 + 62 * (i + 1)} 0" ${S} stroke-width="5"/>`).join('') +
      `<path d="M${-w / 2} ${-h * 0.5} L${w / 2} ${-h * 0.5}" ${S} stroke-width="8"/>`
    : '';
  return `<g>
    <rect x="${-w / 2}" y="${-h}" width="${w}" height="${h}" fill="${slats ? '#bdbdbd' : '#d6d6d6'}" ${S} stroke-width="${Math.max(4, w / 40)}"/>
    ${wood}
    ${tape && !slats ? `<rect x="-${w * 0.07}" y="${-h}" width="${w * 0.14}" height="${h}" fill="#f2f2f2" ${S} stroke-width="2.5"/>` : ''}
    <path d="M${-w / 2} ${-h + h * 0.18} L${w / 2} ${-h + h * 0.18}" ${S} stroke-width="3" opacity=".5"/>
  </g>`;
}

/** The stamping machine: a plunger over a hex-e die. Origin = die face. */
export function stamper(s = 1) {
  return `<g transform="scale(${s})">
    <rect x="-10" y="-300" width="20" height="230" fill="#8d8d8d" ${S} stroke-width="5"/>
    <rect x="-46" y="-86" width="92" height="64" rx="8" fill="#555" ${S} stroke-width="6"/>
    <g transform="translate(0 -22) scale(1 0.5)">${hexE(34, { color: false, line: 5 })}</g>
  </g>`;
}

export function stars(seed = 1, n = 60) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: n }, () => `<circle cx="${(rand() * 1900 - 300).toFixed(0)}" cy="${(rand() * 720).toFixed(0)}" r="${(0.8 + rand() * 2.4).toFixed(1)}" fill="#fff" opacity="${(0.5 + rand() * 0.5).toFixed(2)}"/>`).join('');
}

export function moon(r = 190) {
  return `<g><circle r="${r}" fill="url(#fh-moon)" ${S} stroke-width="7"/>
    <ellipse cx="${-r * 0.35}" cy="${-r * 0.25}" rx="${r * 0.2}" ry="${r * 0.17}" fill="#bdbdbd" ${S} stroke-width="4"/>
    <ellipse cx="${r * 0.3}" cy="${r * 0.2}" rx="${r * 0.28}" ry="${r * 0.22}" fill="#c9c9c9" ${S} stroke-width="4"/>
    <ellipse cx="${r * 0.05}" cy="${-r * 0.55}" rx="${r * 0.12}" ry="${r * 0.1}" fill="#bdbdbd" ${S} stroke-width="4"/></g>`;
}

/**
 * A cartoon freighter facing right. Origin = middle of the hull. `open` draws the cargo hold as a
 * dark opening (a scene puts the crate and a door in front of it) instead of a closed grey panel.
 */
export function freighter(id, { open = false } = {}) {
  return `<g>
    <g data-t="${id}.flame"><path d="M-170 -22 Q-290 -4 -330 0 Q-290 4 -170 22Z" fill="#fff" ${S} stroke-width="5"/><path d="M-170 -10 Q-230 0 -170 10Z" fill="#9a9a9a"/></g>
    <rect x="-170" y="-46" width="40" height="92" rx="8" fill="#6f6f6f" ${S} stroke-width="6"/>
    <path d="M-130 -62 L110 -62 Q190 -62 222 -8 Q236 14 220 32 L110 62 L-130 62Z" fill="#e1e1e1" ${S} stroke-width="7"/>
    <path d="M122 -52 Q176 -52 198 -12 L122 -12Z" fill="#fff" ${S} stroke-width="5"/>
    <rect x="-96" y="-40" width="150" height="86" rx="6" fill="${open ? '#161616' : '#8d8d8d'}" ${S} stroke-width="6"/>
    ${open ? '' : `<path d="M-96 -12 L54 -12 M-96 16 L54 16" ${S} stroke-width="3" opacity=".6"/>`}
    <g transform="translate(150 30) scale(0.5)">${hexE(40, { color: false, line: 7 })}</g>
    <path d="M-60 62 L-110 100 L-10 100 L10 62" fill="#bdbdbd" ${S} stroke-width="6"/>
    <path d="M60 62 L20 100 L100 100 L90 62" fill="#bdbdbd" ${S} stroke-width="6"/>
  </g>`;
}

/** A FedHex delivery station: a low depot with a hexagonal-e sign and a dish. Origin = bottom centre. */
export function station() {
  return `<g>
    <rect x="-220" y="-170" width="440" height="170" fill="#d6d6d6" ${S} stroke-width="7"/>
    <rect x="-250" y="-190" width="500" height="30" rx="6" fill="#8d8d8d" ${S} stroke-width="7"/>
    <rect x="-150" y="-110" width="140" height="110" fill="#2a2a2a" ${S} stroke-width="6"/>
    <rect x="40" y="-130" width="130" height="62" fill="#fff" ${S} stroke-width="5"/>
    <g transform="translate(0 -250)"><path d="M0 62 L0 36" ${S} stroke-width="6"/>${hexE(64, { color: false, line: 6 })}</g>
    <path d="M170 -190 L170 -250 M170 -250 Q214 -280 232 -236 Q198 -226 170 -250Z" fill="#cfcfcf" ${S} stroke-width="5"/>
  </g>`;
}

/** The FedHex wordmark in the approved colours: Fed purple, Hex orange, with the hexagonal e. */
export function wordmark(size = 190) {
  return `<g font-family="${SANS}" font-weight="900" font-style="italic">
    <text x="-8" y="0" font-size="${size}" text-anchor="end" fill="${PURPLE}" stroke="#fff" stroke-width="2">Fed</text>
    <text x="-8" y="0" font-size="${size}" text-anchor="start" fill="${ORANGE}" stroke="#fff" stroke-width="2">Hex</text>
  </g>`;
}

export { SERIF, SANS };
