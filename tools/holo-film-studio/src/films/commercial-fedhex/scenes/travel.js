/**
 * 7-11 s. The epic delivery montage in three quick shots: the crate is secured in a freighter, the
 * freighter streaks past a moon, and it lands at a FedHex delivery station on another planet.
 */
import { Track, tween } from '../../../acting.js';
import { dust, puff, sparkle, speedLines } from '../../../fx/effects.js';
import { INK } from '../../../art/props.js';
import { GROUND_Y, freighter, parcel, moon, stars, station, hexE } from '../world.js';

/** The crate is secured in the freighter's hold. */
export function load(ctx) {
  const { cues, at, id } = ctx;
  const ship = new Track(cues, `${id}.ship`, { x: 760, y: 450, sx: 1.3, sy: 1.3 });
  const crate = new Track(cues, `${id}.crate`, { x: 150, y: GROUND_Y - 4 });
  crate.to(at(100), 700, { x: 706, y: 506 }, { ease: 'ease-in-out', reduce: 'snap' });
  const door = new Track(cues, `${id}.door`, { x: 0, y: -100 });
  door.to(at(850), 260, { y: 0 }, { ease: 'ease-in', reduce: 'snap' });
  // The hold is at the freighter's middle: local (-21, 3), scaled 1.3.
  const hold = `<g transform="translate(760 450) scale(1.3)"><rect x="-96" y="-40" width="150" height="86" fill="#161616"/></g>`;
  const doorHtml = `<g transform="translate(760 450) scale(1.3)"><g data-t="${id}.door" style="${door.css}"><rect x="-96" y="-40" width="150" height="86" rx="6" fill="#8d8d8d" stroke="${INK}" stroke-width="6"/><path d="M-96 -12 L54 -12 M-96 16 L54 16" stroke="${INK}" stroke-width="3" opacity=".6"/></g></g>`;
  const fx = dust({ x: 700, y: GROUND_Y + 6, at: at(1000), n: 4, spread: 50, r: 22, seed: 7 }) + sparkle({ x: 760, y: 400, at: at(1100), dur: 700, r: 26, n: 2 });
  return `<rect x="-300" y="-100" width="1880" height="760" fill="url(#fh-wall)"/>
    <path d="M-300 ${GROUND_Y} L1580 ${GROUND_Y} L1580 820 L-300 820Z" fill="url(#fh-floor)" stroke="${INK}" stroke-width="5"/>
    <g data-t="${id}.ship" style="${ship.css}">${freighter(`${id}.s`, { open: true })}</g>
    ${hold}
    <g data-t="${id}.crate" style="${crate.css}">${parcel(120, 100, { slats: true })}</g>
    ${doorHtml}${fx}`;
}

/** The freighter streaks past a moon. */
export function fly(ctx) {
  const { cues, at, id, dur } = ctx;
  const ship = new Track(cues, `${id}.ship`, { x: -420, y: 400, sx: 1.0, sy: 1.0, rot: -3 });
  ship.to(at(0), dur, { x: 1750, rot: 2 }, { ease: 'ease-in-out', reduce: 'snap' });
  const mo = new Track(cues, `${id}.moon`, { x: 930, y: 330 });
  mo.to(at(0), dur, { x: 790 }, { ease: 'linear', reduce: 'skip' });
  cues.push({ at: at(0), dur: 200, iterations: Math.floor(dur / 200), target: `${id}.streaks`, keyframes: [{ transform: 'translateX(0px)' }, { transform: 'translateX(-240px)' }], easing: 'linear', reduce: 'skip' });
  const streaks = Array.from({ length: 14 }, (_, i) => `<path d="M${200 + i * 240} ${60 + ((i * 97) % 600)} l150 0" stroke="#fff" stroke-width="3" opacity=".5" stroke-linecap="round"/>`).join('');
  const fx = `<g transform="translate(0 0)">${speedLines({ x: 640, y: 400, at: at(0), dur: 240, total: dur, n: 8, len: 300, dir: 1, spreadY: 200, seed: 9 })}</g>`;
  return `<rect x="-300" y="-100" width="1880" height="920" fill="url(#fh-space)"/>
    <g>${stars(5, 70)}</g>
    <g data-t="${id}.moon" style="${mo.css}">${moon(210)}</g>
    <g data-t="${id}.streaks" style="transform:translateX(0px)">${streaks}</g>
    <g data-t="${id}.ship" style="${ship.css}">${freighter(`${id}.s`)}</g>${fx}`;
}

/** The freighter lands at a FedHex delivery station on another planet. */
export function arrive(ctx) {
  const { cues, at, id } = ctx;
  const ship = new Track(cues, `${id}.ship`, { x: -300, y: 80, sx: 0.9, sy: 0.9, rot: 8 });
  ship.keys(at(0), 900, [{ o: 0.7, x: 330, y: 470, rot: 3, ease: 'ease-out' }, { o: 1, x: 340, y: 504, rot: 0, ease: 'ease-in-out' }], { ease: 'linear', reduce: 'snap' });
  const crate = new Track(cues, `${id}.crate`, { x: 560, y: GROUND_Y - 2 });
  tween(cues, `${id}.crate`, at(1000), 120, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
  crate.to(at(1000), 280, { x: 640 }, { ease: 'ease-out', reduce: 'snap' });
  const fx = dust({ x: 330, y: GROUND_Y + 8, at: at(820), n: 7, spread: 120, r: 36, seed: 12 }) + puff({ x: 330, y: GROUND_Y - 20, at: at(850), dur: 900, r: 60, dy: -40, fill: 'url(#g-dust)' }) + sparkle({ x: 640, y: 520, at: at(1050), dur: 600, r: 24, n: 1 });
  const planet = `<g transform="translate(980 190)"><circle r="120" fill="#cdcdcd" stroke="${INK}" stroke-width="7"/><path d="M-96 -52 Q0 -26 96 -62 M-116 14 Q0 44 116 4 M-100 70 Q0 96 98 66" fill="none" stroke="#9a9a9a" stroke-width="12"/>
      <ellipse rx="200" ry="40" transform="rotate(-18)" fill="none" stroke="${INK}" stroke-width="7"/><ellipse rx="200" ry="40" transform="rotate(-18)" fill="none" stroke="#efefef" stroke-width="3"/></g>`;
  return `<rect x="-300" y="-100" width="1880" height="920" fill="url(#fh-sky)"/>
    <g>${stars(8, 40)}</g>${planet}
    <path d="M-300 ${GROUND_Y - 4} Q400 ${GROUND_Y - 36} 1580 ${GROUND_Y - 6} L1580 820 L-300 820Z" fill="url(#fh-floor)" stroke="${INK}" stroke-width="6"/>
    <g transform="translate(1000 ${GROUND_Y - 8})">${station()}</g>
    <g data-t="${id}.ship" style="${ship.css}">${freighter(`${id}.s`)}</g>
    <g data-t="${id}.crate" style="opacity:0;${crate.css}">${parcel(120, 100, { slats: true })}</g>${fx}`;
}

void hexE;
