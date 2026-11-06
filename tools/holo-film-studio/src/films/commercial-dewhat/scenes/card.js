/**
 * 12.4-15 s. Smash cut to an excessively cheerful, inexpensive-looking company card, with the
 * approved slogan. The jingle sting is drawn, not played: the film is silent.
 */
import { tween } from '../../../acting.js';
import { Track } from '../../../acting.js';
import { sparkle } from '../../../fx/effects.js';
import { INK } from '../../../art/props.js';
import { TEXT } from '../config.js';

const SANS = "'Arial Black','Trebuchet MS',Impact,'DejaVu Sans',sans-serif";

function burst(n = 24, r = 1100) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 0.5) / n) * Math.PI * 2;
    d += `M0 0 L${(Math.cos(a0) * r).toFixed(0)} ${(Math.sin(a0) * r).toFixed(0)} L${(Math.cos(a1) * r).toFixed(0)} ${(Math.sin(a1) * r).toFixed(0)}Z `;
  }
  return d;
}

export function card(ctx) {
  const { cues, at, id } = ctx;
  const rays = new Track(cues, `${id}.rays`, { x: 640, y: 380, rot: 0 });
  rays.to(at(0), ctx.dur, { rot: 12 }, { ease: 'linear', reduce: 'skip' });

  // The logo bounces in, then the slogan ribbon slides up; the notes pop for the sting.
  const logo = new Track(cues, `${id}.logo`, { x: 640, y: 200, sx: 0.1, sy: 0.1 });
  logo.keys(at(120), 520, [{ o: 0.55, sx: 1.22, sy: 1.22, ease: 'ease-out' }, { o: 0.8, sx: 0.94, sy: 0.94 }, { o: 1, sx: 1, sy: 1 }], { ease: 'linear', reduce: 'snap' });
  const ribbon = new Track(cues, `${id}.ribbon`, { x: 640, y: 560 });
  ribbon.to(at(560), 420, { y: 470 }, { ease: 'cubic-bezier(.2,.8,.3,1)', reduce: 'snap' });
  tween(cues, `${id}.ribbon`, at(560), 200, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
  const notes = [
    [150, 250, '♪', 130],
    [1120, 220, '♫', 150],
    [230, 420, '♫', 110],
    [1060, 410, '♪', 120],
  ];
  const noteHtml = notes
    .map(([x, y, g, s], i) => {
      const n = new Track(cues, `${id}.note${i}`, { x, y, sy: 0.2, sx: 0.2 });
      n.keys(at(300 + i * 130), 380, [{ o: 0.6, sx: 1.2, sy: 1.2, y: y - 30, ease: 'ease-out' }, { o: 1, sx: 1, sy: 1, y: y - 20 }], { ease: 'linear', reduce: 'snap' });
      return `<g data-t="${id}.note${i}" style="${n.css}"><text font-size="${s}" font-weight="900" text-anchor="middle" fill="#e2231a" stroke="${INK}" stroke-width="6" paint-order="stroke" font-family="${SANS}">${g}</text></g>`;
    })
    .join('');
  const stars = [
    [96, 96],
    [1184, 96],
    [96, 624],
    [1184, 624],
  ]
    .map(([x, y]) => `<path transform="translate(${x} ${y})" d="M0 -34 L10 -11 L35 -10 L15 6 L22 31 L0 17 L-22 31 L-15 6 L-35 -10 L-10 -11Z" fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`)
    .join('');

  const fx = sparkle({ x: 360, y: 150, at: at(700), dur: 800, r: 30 }) + sparkle({ x: 930, y: 270, at: at(900), dur: 800, r: 26 });
  const [s1, s2] = TEXT.slogan;
  return `<rect width="1280" height="720" fill="#ffd21f"/>
    <g data-t="${id}.rays" style="${rays.css}"><path d="${burst()}" fill="#ffb800"/></g>
    <rect x="22" y="22" width="1236" height="676" fill="none" stroke="#e2231a" stroke-width="16"/>
    <rect x="44" y="44" width="1192" height="632" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="26 14"/>
    ${stars}${noteHtml}
    <g data-t="${id}.logo" style="${logo.css}">
      <text y="70" font-size="190" font-weight="900" text-anchor="middle" fill="${INK}" font-family="${SANS}" transform="translate(7 8)">${TEXT.brand}</text>
      <text y="70" font-size="190" font-weight="900" text-anchor="middle" fill="#e2231a" stroke="#fff" stroke-width="12" paint-order="stroke" font-family="${SANS}">${TEXT.brand}</text>
    </g>
    <g data-t="${id}.ribbon" style="opacity:0;${ribbon.css}">
      <path d="M-540 -92 L540 -92 L560 0 L540 92 L-540 92 L-560 0Z" fill="#1d4fd7" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
      <path d="M-510 -66 L510 -66 M-510 66 L510 66" stroke="#fff" stroke-width="3" stroke-dasharray="14 10"/>
      <text y="-6" font-size="62" font-weight="900" text-anchor="middle" fill="#fff" font-family="${SANS}">${s1}</text>
      <text y="58" font-size="62" font-weight="900" text-anchor="middle" fill="#ffe36a" font-family="${SANS}">${s2}</text>
    </g>
    ${fx}`;
}
