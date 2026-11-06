/**
 * "Visit Skatboll!" commercial - the panning art, the tourism-board lettering and the postcard frame.
 */
import { FX_DEFS } from '../../fx/effects.js';
import { INK } from '../../art/props.js';
import { Track, tween } from '../../acting.js';

const SANS = "'Arial Black','Trebuchet MS',Impact,'DejaVu Sans',sans-serif";

export const WORLD_DEFS = FX_DEFS;

export const FRAME = { w: 1280, h: 720 };

/**
 * A 4:1 location panorama scaled to fill the frame's height and panned horizontally.
 * `fromX` / `toX` are the picture's left edge in frame pixels (0 = flush left; the most it can
 * slide is `frameW - scaledWidth`). Returns { html, track, scaledW }.
 */
export function panorama(cues, id, art, { at, dur, fromX, toX, zoom = 1, fx = '' }) {
  const scale = (FRAME.h / art.h) * zoom;
  const scaledW = art.w * scale;
  const track = new Track(cues, id, { x: fromX, y: 0 });
  track.to(at, dur, { x: toX }, { ease: 'ease-in-out', reduce: 'snap' });
  // The picture and anything that must stay on it (sparks) share one panning group.
  const html = `<g data-t="${id}" style="${track.css}">
    <image href="${art.src}" x="0" y="0" width="${scaledW.toFixed(1)}" height="${(art.h * scale).toFixed(1)}" preserveAspectRatio="none"/>
    ${fx}
  </g>`;
  return { html, track, scaledW, scale };
}

/** The white postcard border every segment sits in. */
export function postcardFrame() {
  return `<rect x="14" y="14" width="1252" height="692" fill="none" stroke="#fff" stroke-width="28"/>
    <rect x="28" y="28" width="1224" height="664" fill="none" stroke="${INK}" stroke-width="4"/>
    <rect x="0" y="0" width="1280" height="720" fill="none" stroke="${INK}" stroke-width="6"/>`;
}

/**
 * Exaggerated tourism-board lettering: chunky yellow capitals with a heavy outline and a hard
 * shadow, popping in with an overshoot. `lines` are the strings, `size` caps their size, `y` is
 * the vertical centre of the block, `rot` a jaunty tilt. Returns { html, popIn(at), out(at) }.
 */
export function banner(cues, id, lines, { y = 540, size = 104, rot = -2.5, fill = '#ffe23a' } = {}) {
  const items = lines.map((l) => (typeof l === 'string' ? { t: l } : l));
  const widest = Math.max(...items.map((l) => l.t.length));
  const fit = Math.min(size, Math.floor(1060 / (widest * 0.74)));
  const sizes = items.map((l) => Math.min(l.size ?? fit, Math.floor(1060 / (l.t.length * 0.74))));
  const heights = sizes.map((s) => s * 1.08);
  const total = heights.reduce((a, b) => a + b, 0);
  const track = new Track(cues, id, { x: 640, y, sx: 0.1, sy: 0.1, rot });
  let cursor = -total / 2;
  const text = items
    .map((l, i) => {
      const s = sizes[i];
      cursor += heights[i];
      const ty = cursor - heights[i] * 0.5 + s * 0.34;
      return `<text transform="translate(7 8)" y="${ty.toFixed(1)}" font-size="${s}" font-weight="900" text-anchor="middle" font-family="${SANS}" fill="${INK}" stroke="${INK}" stroke-width="22" stroke-linejoin="round">${l.t}</text>
        <text y="${ty.toFixed(1)}" font-size="${s}" font-weight="900" text-anchor="middle" font-family="${SANS}" fill="${fill}" stroke="${INK}" stroke-width="12" paint-order="stroke" stroke-linejoin="round">${l.t}</text>`;
    })
    .join('');
  const html = `<g data-t="${id}" style="opacity:0;${track.css}">${text}</g>`;
  return {
    id,
    html,
    popIn(at) {
      tween(cues, id, at, 100, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
      track.keys(at, 360, [{ o: 0.55, sx: 1.14, sy: 1.14, ease: 'ease-out' }, { o: 0.8, sx: 0.97, sy: 0.97 }, { o: 1, sx: 1, sy: 1 }], { ease: 'linear', reduce: 'snap' });
      return this;
    },
  };
}
