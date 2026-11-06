/**
 * 13-15 s. The smiling corporate ident: the real FedHex hub art, the real FedHex logo, and the
 * approved one-off line.
 */
import { Track, tween } from '../../../acting.js';
import { sparkle } from '../../../fx/effects.js';
import { INK } from '../../../art/props.js';
import { ART, TEXT } from '../config.js';
import { PURPLE, ORANGE, SANS } from '../world.js';

export function ident(ctx) {
  const { cues, at, id, dur } = ctx;
  const scale = 720 / ART.hub.h;
  const w = ART.hub.w * scale;
  const pan = new Track(cues, `${id}.pan`, { x: -780, y: 0, sx: 1, sy: 1 });
  pan.to(at(0), dur, { x: -840 }, { ease: 'linear', reduce: 'snap' });

  const plate = new Track(cues, `${id}.plate`, { x: 640, y: 250, sx: 0.2, sy: 0.2 });
  plate.keys(at(0), 420, [{ o: 0.6, sx: 1.08, sy: 1.08, ease: 'ease-out' }, { o: 1, sx: 1, sy: 1 }], { ease: 'linear', reduce: 'snap' });
  tween(cues, `${id}.plate`, at(0), 120, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
  const band = new Track(cues, `${id}.band`, { x: 640, y: 600 });
  band.to(at(520), 320, { y: 560 }, { ease: 'ease-out', reduce: 'snap' });
  tween(cues, `${id}.band`, at(520), 200, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });

  const [l1, l2] = TEXT.line;
  return `<g data-t="${id}.pan" style="${pan.css}">
      <image href="${ART.hub.src}" x="0" y="0" width="${w.toFixed(0)}" height="720" preserveAspectRatio="none"/>
    </g>
    <rect width="1280" height="720" fill="#14041f" opacity=".42"/>
    <g data-t="${id}.plate" style="opacity:0;${plate.css}">
      <rect x="-470" y="-150" width="940" height="300" rx="34" fill="#fff" stroke="${INK}" stroke-width="8"/>
      <image href="${ART.logo.src}" x="-400" y="${(-400 * ART.logo.h) / ART.logo.w}" width="800" height="${(800 * ART.logo.h) / ART.logo.w}" preserveAspectRatio="xMidYMid meet"/>
    </g>
    <g data-t="${id}.band" style="opacity:0;${band.css}">
      <path d="M-640 -78 L640 -78 L640 112 L-640 112Z" fill="${PURPLE}" stroke="${INK}" stroke-width="7" opacity=".96"/>
      <path d="M-640 -78 L640 -78" stroke="${ORANGE}" stroke-width="12"/>
      <text y="-8" font-size="64" font-weight="900" text-anchor="middle" fill="#fff" font-family="${SANS}">${l1}</text>
      <text y="68" font-size="64" font-weight="900" text-anchor="middle" fill="#fff" font-family="${SANS}">${l2}</text>
    </g>
    ${sparkle({ x: 905, y: 170, at: at(500), dur: 900, r: 30, n: 3 })}`;
}
