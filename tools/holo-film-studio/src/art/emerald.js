/**
 * The giant gem and its museum furniture. Grayscale only: the facets alternate between near-white and
 * near-black so the stone reads as a huge, valuable, cut gem without any colour.
 *
 *   emerald(id, { w, h })  emerald-cut octagon, origin = bottom centre (it stands on its base)
 *   plinth(w)              stepped stone display plinth, origin = top-centre of the slab
 *   stanchion()            velvet-rope post, origin = base
 *   rope(x0, x1)           sagging velvet rope between two stanchions at the post-top height
 *   placard(lines)         brass plaque on a stand, origin = base
 */
import { INK } from './props.js';

const S = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;

/** Octagon ring vertices for a W x H gem inset by `i` px (origin bottom centre). */
function ring(W, H, i) {
  const c = Math.max(8, 84 - i * 0.55);
  const l = -W / 2 + i;
  const r = W / 2 - i;
  const t = -H + i;
  const b = -i;
  return [[l + c, t], [r - c, t], [r, t + c], [r, b - c], [r - c, b], [l + c, b], [l, b - c], [l, t + c]];
}

const SHADE = [
  ['#f4f4f4', '#cfcfcf', '#8c8c8c', '#505050', '#262626', '#5a5a5a', '#a4a4a4', '#e2e2e2'],
  ['#d4d4d4', '#a8a8a8', '#6c6c6c', '#363636', '#1c1c1c', '#464646', '#848484', '#bcbcbc'],
];

/** The Emerald. `w` x `h` is the full outline; `id` prefixes data-t names (`${id}.shine` is its glint layer). */
export function emerald(id, { w = 300, h = 360 } = {}) {
  const rings = [ring(w, h, 0), ring(w, h, 44), ring(w, h, 92)];
  const P = (pts) => pts.map((p) => p.join(',')).join(' ');
  let facets = '';
  for (let layer = 0; layer < 2; layer++) {
    const a = rings[layer];
    const b = rings[layer + 1];
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      facets += `<polygon points="${P([a[i], a[j], b[j], b[i]])}" fill="${SHADE[layer][i]}" ${S} stroke-width="3.2"/>`;
    }
  }
  const tbl = rings[2];
  const cx = 0;
  const cy = -h / 2;
  return `<g>
    <defs><linearGradient id="${id}.tbl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8e8e8"/><stop offset=".45" stop-color="#8a8a8a"/><stop offset="1" stop-color="#2e2e2e"/></linearGradient></defs>
    <polygon points="${P(rings[0])}" fill="#2b2b2b" ${S} stroke-width="7"/>
    ${facets}
    <polygon points="${P(tbl)}" fill="url(#${id}.tbl)" ${S} stroke-width="4"/>
    <path d="M${cx - w * 0.2} ${cy - h * 0.05} L${cx - w * 0.02} ${cy - h * 0.3} L${cx + w * 0.02} ${cy - h * 0.3} L${cx - w * 0.15} ${cy + h * 0.02}Z" fill="#fff" opacity=".85"/>
    <path d="M${cx + w * 0.02} ${cy - h * 0.02} L${cx + w * 0.1} ${cy - h * 0.2} L${cx + w * 0.12} ${cy - h * 0.2} L${cx + w * 0.06} ${cy}Z" fill="#fff" opacity=".6"/>
    <polygon points="${P(rings[0])}" fill="none" ${S} stroke-width="7"/>
    <path d="M${rings[0][0][0]} ${rings[0][0][1]} L${rings[1][0][0]} ${rings[1][0][1]} M${rings[0][1][0]} ${rings[0][1][1]} L${rings[1][1][0]} ${rings[1][1][1]}" stroke="#fff" stroke-width="2" opacity=".7"/>
    <g data-t="${id}.shine"></g>
  </g>`;
}

/** Heavy stepped plinth. Origin = top-centre of the upper slab. `w` is the width of the lower step. */
export function plinth(w = 420, h = 150) {
  return `<g>
    <rect x="${-w / 2}" y="${h * 0.45}" width="${w}" height="${h * 0.55}" fill="#8f8f8f" ${S} stroke-width="6"/>
    <rect x="${-w / 2}" y="${h * 0.45}" width="${w}" height="12" fill="#bdbdbd" ${S} stroke-width="4"/>
    <rect x="${-w / 2 + 22}" y="0" width="${w - 44}" height="${h * 0.45}" fill="#a6a6a6" ${S} stroke-width="6"/>
    <rect x="${-w / 2 + 22}" y="0" width="${w - 44}" height="10" fill="#d4d4d4" ${S} stroke-width="3.4"/>
    <path d="M${-w / 2 + 40} ${h * 0.58} L${-w / 2 + 40} ${h * 0.94} M${w / 2 - 40} ${h * 0.58} L${w / 2 - 40} ${h * 0.94}" stroke="#6a6a6a" stroke-width="4"/>
    <path d="M${-w / 2 + 6} ${h * 0.78} L${w / 2 - 6} ${h * 0.78}" stroke="#555" stroke-width="2" opacity=".6"/>
  </g>`;
}

export function stanchion() {
  return `<g>
    <ellipse cx="0" cy="-4" rx="30" ry="8" fill="#6d6d6d" ${S} stroke-width="4.4"/>
    <rect x="-6" y="-120" width="12" height="116" fill="#bdbdbd" ${S} stroke-width="4.4"/>
    <circle cx="0" cy="-124" r="11" fill="#e4e4e4" ${S} stroke-width="4.4"/>
    <path d="M-3 -112 L-3 -14" stroke="#fff" stroke-width="2" opacity=".7"/>
  </g>`;
}

/** Velvet rope drooping between two stanchion tops (coordinates relative to the left stanchion base). */
export function rope(len = 280) {
  return `<path d="M0 -118 Q${len / 2} -68 ${len} -118" fill="none" ${S} stroke-width="11"/><path d="M0 -118 Q${len / 2} -68 ${len} -118" fill="none" stroke="#6a6a6a" stroke-width="6"/>`;
}

export function placard(lines = ['THE NEBULA HEART', 'EMERALD']) {
  return `<g>
    <path d="M-4 0 L-4 -40 M4 0 L4 -40" ${S} stroke-width="6"/>
    <g transform="translate(0 -40) skewX(-6)"><rect x="-84" y="-52" width="168" height="54" rx="4" fill="#dcdcdc" ${S} stroke-width="5"/>
    <rect x="-77" y="-45" width="154" height="40" rx="2" fill="none" stroke="#555" stroke-width="1.6"/>
    <text y="-28" font-size="15" font-weight="900" text-anchor="middle" fill="${INK}" font-family="Georgia, serif" letter-spacing="1">${lines[0]}</text>
    <text y="-10" font-size="19" font-weight="900" text-anchor="middle" fill="${INK}" font-family="Georgia, serif" letter-spacing="2">${lines[1] || ''}</text></g>
  </g>`;
}
