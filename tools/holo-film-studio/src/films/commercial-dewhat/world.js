/**
 * "DeWHAT" commercial - the workshop, the window sign and the speech balloons.
 * Static art only; characters are added per scene.
 */
import { FX_DEFS } from '../../fx/effects.js';
import { INK } from '../../art/props.js';
import { Track, tween } from '../../acting.js';

export const GROUND_Y = 640;

const SANS = "'Arial Black','Trebuchet MS',Impact,'DejaVu Sans',sans-serif";

export const WORLD_DEFS = `
  ${FX_DEFS}
  <linearGradient id="dw-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6e6e6"/><stop offset="1" stop-color="#bdbdbd"/></linearGradient>
  <linearGradient id="dw-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a3a3a3"/><stop offset="1" stop-color="#6a6a6a"/></linearGradient>
  <radialGradient id="dw-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".55" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <linearGradient id="dw-night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1a1a"/><stop offset="1" stop-color="#3a3a3a"/></linearGradient>
`;

/** The workshop: back wall, shelves with jars and tools, a bench, a dead lamp and a fuse panel. */
export function workshop() {
  const jar = (x, y, h = 46) =>
    `<g transform="translate(${x} ${y})"><rect x="-14" y="${-h}" width="28" height="${h}" rx="5" fill="#f4f4f4" stroke="${INK}" stroke-width="4"/><rect x="-16" y="${-h - 8}" width="32" height="10" rx="3" fill="#777" stroke="${INK}" stroke-width="3.4"/><path d="M-8 ${-h + 12} L8 ${-h + 12}" stroke="#999" stroke-width="3"/></g>`;
  const shelf = (x, y, w) =>
    `<path d="M${x} ${y} L${x + w} ${y}" stroke="${INK}" stroke-width="10" stroke-linecap="round"/><path d="M${x + 24} ${y + 5} l-16 52 M${x + w - 24} ${y + 5} l16 52" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
  return `<rect x="-300" y="-100" width="1880" height="760" fill="url(#dw-wall)"/>
    <path d="M-300 ${GROUND_Y - 4} L1580 ${GROUND_Y - 4} L1580 820 L-300 820Z" fill="url(#dw-floor)" stroke="${INK}" stroke-width="5"/>
    ${shelf(60, 250, 320)}${jar(110, 250)}${jar(160, 250, 58)}${jar(214, 250, 40)}${jar(270, 250, 52)}${jar(326, 250, 44)}
    ${shelf(60, 380, 320)}${jar(120, 380, 40)}${jar(182, 380, 54)}${jar(248, 380, 46)}${jar(312, 380, 36)}
    <g transform="translate(900 150)"><rect x="-120" y="-70" width="240" height="190" rx="12" fill="#cfcfcf" stroke="${INK}" stroke-width="7"/><rect x="-100" y="-50" width="200" height="150" rx="6" fill="#8d8d8d" stroke="${INK}" stroke-width="4"/>
      <text y="14" font-size="42" font-weight="900" text-anchor="middle" fill="#222" font-family="${SANS}" letter-spacing="2">POWER</text>
      <rect x="-50" y="32" width="100" height="46" rx="6" fill="#444" stroke="${INK}" stroke-width="4"/><circle cx="-30" cy="55" r="9" fill="#888"/><circle cx="0" cy="55" r="9" fill="#888"/><circle cx="30" cy="55" r="9" fill="#888"/></g>
    <path d="M640 -20 L640 96" stroke="${INK}" stroke-width="6"/><path d="M596 150 Q596 98 640 98 Q684 98 684 150Z" fill="#c9c9c9" stroke="${INK}" stroke-width="6"/><ellipse cx="640" cy="152" rx="30" ry="8" fill="#9a9a9a" stroke="${INK}" stroke-width="4"/>
    <g transform="translate(640 ${GROUND_Y - 4})"><rect x="-300" y="-96" width="600" height="22" rx="4" fill="#777" stroke="${INK}" stroke-width="6"/><rect x="-282" y="-74" width="22" height="74" fill="#555" stroke="${INK}" stroke-width="5"/><rect x="260" y="-74" width="22" height="74" fill="#555" stroke="${INK}" stroke-width="5"/></g>`;
}

/**
 * A speech balloon at (x, y), centred on itself so it can pop from its middle. `tailX` is where
 * the tail points, relative to the balloon's centre (the speaker is below it). The whole balloon
 * is one target: `${id}` (opacity + pose). Returns { html, appear(at), vanish(at), pulse(at) }.
 */
export function speech(cues, id, lines, { x, y: yIn, bottom, tailX = 0, size = 52, tilt = 0 }) {
  const widest = Math.max(...lines.map((l) => l.length));
  const w = Math.max(220, Math.round(widest * size * 0.72) + 64);
  const lineH = size * 1.16;
  const h = Math.round(lines.length * lineH + 44);
  const tx = Math.max(-w / 2 + 50, Math.min(w / 2 - 50, tailX));
  const y = bottom != null ? bottom - h / 2 : yIn;
  const track = new Track(cues, id, { x, y, sx: 0.2, sy: 0.2, rot: tilt });
  const text = lines
    .map(
      (l, i) =>
        `<text x="0" y="${(-(lines.length - 1) / 2 + i) * lineH + size * 0.34}" font-size="${size}" font-weight="900" text-anchor="middle" fill="${INK}" font-family="${SANS}">${l}</text>`
    )
    .join('');
  const html = `<g data-t="${id}" style="opacity:0;${track.css}">
    <path d="M${tx - 26} ${h / 2 - 4} L${tx + 8} ${h / 2 + 58} L${tx + 30} ${h / 2 - 4}Z" fill="#fff" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="34" fill="#fff" stroke="${INK}" stroke-width="7"/>
    <path d="M${tx - 21} ${h / 2 - 3} L${tx + 25} ${h / 2 - 3}" stroke="#fff" stroke-width="10"/>
    ${text}
  </g>`;
  const api = {
    id,
    html,
    w,
    h,
    track,
    appear(at) {
      tween(cues, id, at, 120, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
      track.keys(at, 260, [{ o: 0.6, sx: 1.12, sy: 1.12, ease: 'ease-out' }, { o: 1, sx: 1, sy: 1 }], { ease: 'linear', reduce: 'snap' });
      return api;
    },
    vanish(at) {
      tween(cues, id, at, 160, { opacity: 1 }, { opacity: 0 }, { reduce: 'snap' });
      return api;
    },
    /** A shout: the balloon swells and shivers for `dur` ms. */
    shout(at, dur = 700, grow = 1.14) {
      const n = Math.max(2, Math.round(dur / 70));
      const frames = [];
      for (let i = 1; i < n; i++) frames.push({ o: i / n, sx: grow, sy: grow, rot: tilt + (i % 2 ? 1.6 : -1.6) });
      frames.push({ o: 1, sx: 1, sy: 1, rot: tilt });
      track.keys(at, dur, frames, { ease: 'linear', reduce: 'skip' });
      return api;
    },
  };
  return api;
}

/**
 * The DeWHAT logo: a parody of a famous power-tool maker's. A yellow field with a heavy black bar
 * above and below and chunky black capitals, "DeWHAT" with only the e lowercase, and no question
 * mark. Centred on its own origin; `w` x `h` is the whole plate.
 */
export function dewhatLogo(w = 800, h = 220) {
  const bar = h * 0.18;
  const size = Math.min(h * 0.6, (w * 0.9) / 4.5);
  return `<g>
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="#febd17" stroke="${INK}" stroke-width="7"/>
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${bar}" fill="${INK}"/>
    <rect x="${-w / 2}" y="${h / 2 - bar}" width="${w}" height="${bar}" fill="${INK}"/>
    <text y="${size * 0.35}" font-size="${size}" font-weight="900" text-anchor="middle" fill="${INK}" font-family="${SANS}" letter-spacing="-2">DeWHAT</text>
  </g>`;
}

/** The bright emergency sign seen through the window: the DeWHAT logo over "EMERGENCY POWER ANNEX". */
export function annexSign(id) {
  const bulbs = [];
  for (let i = 0; i < 12; i++) bulbs.push([-250 + i * 45.5, -112], [-250 + i * 45.5, 112]);
  for (let i = 0; i < 4; i++) bulbs.push([-272, -66 + i * 44], [272, -66 + i * 44]);
  return `<g>
    <ellipse data-t="${id}.glow" cx="0" cy="0" rx="470" ry="270" fill="url(#dw-glow)" style="opacity:0"/>
    <g data-t="${id}.board" style="opacity:0">
      <rect x="-290" y="-132" width="580" height="264" rx="22" fill="#111" stroke="#fff" stroke-width="8"/>
      <g transform="translate(0 -30)">${dewhatLogo(470, 128)}</g>
      <path d="M-230 56 L230 56" stroke="#fff" stroke-width="4"/>
      <text y="96" font-size="31" font-weight="900" text-anchor="middle" fill="#fff" font-family="${SANS}" letter-spacing="1">EMERGENCY POWER ANNEX</text>
      ${bulbs.map(([bx, by]) => `<circle cx="${bx.toFixed(0)}" cy="${by}" r="9" fill="#fff" stroke="#111" stroke-width="3"/>`).join('')}
    </g>
  </g>`;
}
