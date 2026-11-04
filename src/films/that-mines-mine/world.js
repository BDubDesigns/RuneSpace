/**
 * Locations for "That Mines Mine!" (static art only; characters and props are
 * added per shot). Everything is grayscale and drawn with an ink outline to
 * match the prospectors.
 */
import { INK, ore } from '../../art/props.js';
import { rng, FX_DEFS } from '../../fx/effects.js';

const S = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;

/** Shared <defs>: gradients and hatching used by the backgrounds, plus the effects' own FX_DEFS. */
export const WORLD_DEFS = `
  <linearGradient id="g-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f4f4"/><stop offset="1" stop-color="#b9b9b9"/></linearGradient>
  <linearGradient id="g-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b4b4b4"/><stop offset="1" stop-color="#6d6d6d"/></linearGradient>
  <linearGradient id="g-ground-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6a6a6"/><stop offset="1" stop-color="#636363"/></linearGradient>
  <radialGradient id="g-sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  ${FX_DEFS}
  <radialGradient id="g-cave" cx=".5" cy=".62" r=".7"><stop offset="0" stop-color="#3a3a3a"/><stop offset=".55" stop-color="#151515"/><stop offset="1" stop-color="#050505"/></radialGradient>
  <radialGradient id="g-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <pattern id="p-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0 L0 12" stroke="#111" stroke-width="1.6" opacity=".28"/></pattern>
  <pattern id="p-hatch2" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-50)"><path d="M0 0 L0 9" stroke="#111" stroke-width="1.5" opacity=".35"/></pattern>
`;

export const GROUND_Y = 588;

/** y of the mine track at x, for the front location (downhill toward the left). */
export const frontTrackY = (x) => 600 + (900 - x) * 0.06;

function cloud(x, y, s, id) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><g ${id ? `data-t="${id}"` : ''}>
    <path d="M-70 20 C-96 20 -96 -12 -66 -12 C-64 -40 -22 -48 -8 -26 C10 -50 56 -36 50 -8 C84 -8 88 20 58 20Z" fill="#fff" ${S} stroke-width="4"/>
  </g></g>`;
}

function sky(id) {
  return `<rect x="-1200" width="3680" height="720" fill="url(#g-sky)"/>
    <circle cx="1060" cy="150" r="120" fill="url(#g-sun)"/><circle cx="1060" cy="150" r="52" fill="#fff" opacity=".9"/>
    ${cloud(220, 130, 1.4, `${id}.cloudA`)}${cloud(620, 78, 1.0, `${id}.cloudB`)}${cloud(930, 260, 0.9, `${id}.cloudC`)}`;
}

function farRidge(y = 0) {
  const ridge = (dx) => `<g transform="translate(${dx} 0)"><path d="M0 470 L70 400 L130 430 L230 330 L310 400 L380 360 L470 440 L560 380 L660 450 L760 400 L860 460 L1000 380 L1100 430 L1180 380 L1280 440 L1280 600 L0 600Z" fill="#c2c2c2" ${S} stroke-width="4"/>
    <path d="M230 330 L270 420 L310 400Z M1000 380 L1040 450 L1100 430Z" fill="#9e9e9e"/></g>`;
  return `<g transform="translate(0 ${y})">${ridge(-1280)}${ridge(0)}${ridge(1280)}</g>`;
}

/** Everything behind the actors in the FRONT location (the mine entrance). */
export function frontBack(id = 'w') {
  return `${sky(id)}${farRidge()}
  <g>
    <path d="M360 592 L500 440 L600 340 L690 280 L780 170 L860 84 L940 160 L1010 250 L1100 320 L1190 410 L1280 520 L1280 592Z" fill="#8f8f8f" ${S} stroke-width="6"/>
    <path d="M860 84 L940 160 L1010 250 L1100 320 L1190 410 L1280 520 L1280 592 L1000 592 L960 440 L900 300Z" fill="#6c6c6c"/>
    <path d="M780 170 L860 84 L900 150 L850 190 L820 160Z" fill="#f4f4f4" ${S} stroke-width="4"/>
    <path d="M360 592 L500 440 L600 340 L690 280 L780 170 L860 84 L940 160 L1010 250 L1100 320 L1190 410 L1280 520 L1280 592Z" fill="url(#p-hatch)"/>
    <path d="M690 280 L720 360 L690 430 M900 300 L930 380 L910 440 M600 340 L640 420" fill="none" ${S} stroke-width="4"/>
  </g>
  <!-- mine entrance -->
  <g>
    <path d="M714 592 L730 420 L990 420 L1006 592Z" fill="#7e7e7e" ${S} stroke-width="5"/>
    <path d="M776 380 L944 380 L944 592 L776 592Z" fill="url(#g-cave)" ${S} stroke-width="5"/>
    ${[[806, 470, 0.75, 0], [908, 506, 0.9, 1], [838, 548, 0.7, 2], [888, 432, 0.6, 1], [926, 560, 0.65, 0]]
      .map(([x, y, s, v]) => `<g transform="translate(${x} ${y}) rotate(${(x % 7) * 6 - 18})">${ore(v, s, 1)}</g>`)
      .join('')}
    <rect x="748" y="372" width="28" height="220" fill="#b2b2b2" ${S} stroke-width="5"/><rect x="944" y="372" width="28" height="220" fill="#b2b2b2" ${S} stroke-width="5"/>
    <path d="M754 380 L754 590 M762 390 L762 540 M950 380 L950 590 M958 400 L958 520" ${S} stroke="#7a7a7a" stroke-width="2"/>
    <rect x="730" y="348" width="260" height="34" rx="4" fill="#c4c4c4" ${S} stroke-width="5.5"/>
    <path d="M740 356 L976 356 M740 372 L980 372" ${S} stroke="#838383" stroke-width="2"/>
    <path d="M748 382 L790 382 L748 424Z M972 382 L930 382 L972 424Z" fill="#a8a8a8" ${S} stroke-width="4.5"/>
    <path d="M900 350 L910 332 L920 350 M860 348 q4 -16 12 -2" fill="none" ${S} stroke-width="3"/>
  </g>
  ${ground()}${track()}`;
}

function ground(top = 588, fill = 'url(#g-ground)') {
  const rand = rng(21);
  let pebbles = '';
  for (let i = 0; i < 26; i++) {
    const x = rand() * 1280;
    const y = top + 18 + rand() * 105;
    pebbles += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(4 + rand() * 9).toFixed(0)}" ry="${(2 + rand() * 4).toFixed(0)}" fill="#555" opacity=".5"/>`;
  }
  return `<path d="M-1200 ${top} L0 ${top} Q320 ${top - 14} 640 ${top - 2} T1280 ${top - 4} L2480 ${top - 4} L2480 720 L-1200 720Z" fill="${fill}" ${S} stroke-width="5"/>${pebbles}
    <path d="M0 ${top + 30} Q300 ${top + 22} 520 ${top + 34} M700 ${top + 60} Q900 ${top + 50} 1280 ${top + 64}" fill="none" stroke="#111" stroke-width="2" opacity=".25"/>`;
}

function track() {
  const ties = [];
  for (let x = 40; x < 960; x += 46) {
    const y = frontTrackY(x);
    ties.push(`<rect x="${x - 7}" y="${(y - 2).toFixed(1)}" width="14" height="14" fill="#555" ${S} stroke-width="2.4"/>`);
  }
  return `${ties.join('')}<path d="M-10 ${frontTrackY(-10).toFixed(1)} L1000 ${frontTrackY(1000).toFixed(1)}" ${S} stroke-width="8"/>
    <path d="M-10 ${(frontTrackY(-10) - 1).toFixed(1)} L1000 ${(frontTrackY(1000) - 1).toFixed(1)}" stroke="#ddd" stroke-width="3" stroke-linecap="round"/>`;
}

/** Foreground dressing that overlaps the actors' feet (drawn after them). */
export function frontFore() {
  return `<g>
    <path d="M-20 720 L-20 670 Q40 640 90 664 Q130 650 160 680 L180 720Z" fill="#505050" ${S} stroke-width="5"/>
    <path d="M1090 720 L1110 676 Q1160 652 1210 668 Q1250 650 1300 680 L1300 720Z" fill="#505050" ${S} stroke-width="5"/>
    <path d="M30 664 Q60 650 84 668" fill="none" stroke="#aaa" stroke-width="5" stroke-linecap="round"/>
  </g>`;
}

/** A saguaro for the left side of the FRONT location. */
export function cactus(x = 150, y = GROUND_Y + 4, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M-14 0 L-14 -120 Q-14 -146 0 -146 Q14 -146 14 -120 L14 0Z" fill="#9a9a9a" ${S} stroke-width="5"/>
    <path d="M-14 -60 L-40 -60 Q-52 -60 -52 -76 L-52 -100 Q-52 -108 -44 -108 Q-36 -108 -36 -100 L-36 -76 L-14 -76Z" fill="#9a9a9a" ${S} stroke-width="5"/>
    <path d="M14 -80 L36 -80 Q48 -80 48 -96 L48 -118 Q48 -126 40 -126 Q32 -126 32 -118 L32 -96 L14 -96Z" fill="#9a9a9a" ${S} stroke-width="5"/>
    <path d="M0 -140 L0 -4 M-7 -120 L-7 -8 M7 -120 L7 -8" fill="none" stroke="#6a6a6a" stroke-width="2.4"/>
  </g>`;
}

/* ------------------------------------------------------------ BACK location */

export const BACK_GROUND_Y = 598;
/** The back slope: track from (1290, 300) to (560, 598). */
export const backTrack = { x0: 1290, y0: 296, x1: 560, y1: 596 };
export const backTrackY = (x) => backTrack.y1 - (x - backTrack.x1) * ((backTrack.y1 - backTrack.y0) / (backTrack.x0 - backTrack.x1));
export const BACK_SLOPE_DEG = (Math.atan2(backTrack.y1 - backTrack.y0, backTrack.x0 - backTrack.x1) * 180) / Math.PI;

export function backWorld(id = 'b') {
  const { x0, y0, x1, y1 } = backTrack;
  const ties = [];
  for (let i = 0; i < 17; i++) {
    const t = i / 16;
    const x = x1 + (x0 - x1) * t;
    const y = y1 + (y0 - y1) * t;
    ties.push(`<rect x="${(x - 6).toFixed(0)}" y="${(y - 1).toFixed(0)}" width="12" height="14" fill="#555" ${S} stroke-width="2.4" transform="rotate(${(-BACK_SLOPE_DEG).toFixed(1)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`);
  }
  return `${sky(id)}${farRidge(-10)}
    <path d="M1290 90 L1120 190 L980 300 L820 440 L600 592 L1290 596Z" fill="#8b8b8b" ${S} stroke-width="6"/>
    <path d="M1290 90 L1200 150 L1230 260 L1290 300Z" fill="#6a6a6a"/>
    <path d="M1290 90 L1120 190 L980 300 L820 440 L600 592 L1290 596Z" fill="url(#p-hatch)"/>
    <path d="M1050 250 L1090 330 L1030 400 M900 380 L930 450 L880 500" fill="none" ${S} stroke-width="4"/>
    ${ground(BACK_GROUND_Y, 'url(#g-ground-b)')}
    ${ties.join('')}
    <path d="M${x1} ${y1 + 2} L${x0} ${y0 + 2}" ${S} stroke-width="8"/><path d="M${x1} ${y1} L${x0} ${y0}" stroke="#ddd" stroke-width="3" stroke-linecap="round"/>`;
}

/* --------------------------------------------------------- close-up backdrops */

/** Radiating comic sunburst for reaction close-ups. Wrap in a rotating <g data-t> if you like. */
export function sunburst(id, tone = ['#d4d4d4', '#ececec']) {
  const n = 28;
  let w = '';
  for (let i = 0; i < n; i += 2) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    w += `<path d="M0 0 L${(Math.cos(a0) * 1500).toFixed(0)} ${(Math.sin(a0) * 1500).toFixed(0)} L${(Math.cos(a1) * 1500).toFixed(0)} ${(Math.sin(a1) * 1500).toFixed(0)}Z"/>`;
  }
  return `<rect width="1280" height="720" fill="${tone[0]}"/><g transform="translate(640 360)"><g data-t="${id}.burst" fill="${tone[1]}">${w}</g></g>`;
}

/** Cave wall: dark strata with embedded gems (the face the cutter attacks). */
export function caveWall(id) {
  const rand = rng(33);
  let gems = '';
  for (let i = 0; i < 26; i++) {
    gems += `<g transform="translate(${(40 + rand() * 1200).toFixed(0)} ${(30 + rand() * 660).toFixed(0)}) rotate(${((rand() - 0.5) * 70).toFixed(0)})">${ore(i, 0.8 + rand() * 0.9, 1)}</g>`;
  }
  return `<rect width="1280" height="720" fill="url(#g-cave)"/>
    <g fill="none" stroke="#4a4a4a" stroke-width="4" opacity=".75"><path d="M-10 160 Q300 120 640 170 T1290 150 M-10 330 Q260 300 560 340 T1290 320 M-10 520 Q320 490 700 530 T1290 510"/></g>
    <rect width="1280" height="720" fill="url(#p-hatch2)"/>${gems}`;
}
