/**
 * Locations for "Rare or Weld Done?" (static art; characters and props are added per shot).
 *
 *   apartment(id)            the thief's shabby room
 *   galleryFront(id)         museum gallery, facing the back wall (the Emerald reveal)
 *   museumFront(id, o)       the fortified wall seen from outside at night (o.hole, o.day, o.fenceView)
 *   wallClose(id)            extreme close-up of the wall surface (the arc close-up)
 *   section(id)              cut-away diorama: gallery (left) | wall slab with the opening | night plaza (right)
 *   plaza / crater / distantRoad / skies
 *
 * Positions the scenes share: GY is the ground line, WALL the cut-out, CRATER where the Emerald lands.
 * Everything is extended past the 1280x720 frame (-1200..2480 and up) so the camera can pan and zoom out.
 */
import { INK } from '../../art/props.js';
import { rng, FX_DEFS } from '../../fx/effects.js';
import { NAMES, TEXT } from './config.js';

const S = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;

export const GY = 612;
/** The doorway the thief cuts: centre x, half width, top y (arched), in FRONT view. */
export const WALL = { cx: 760, hw: 96, top: 352 };
/** Where the Emerald lands outside the museum (front view x) and the crater's size. */
export const CRATER = { x: 640, rx: 330, ry: 52 };

/**
 * The finished attraction (FRONT view, night or day): crater + Emerald at YARD.cx, a fence around it
 * (front, two side wings, back), the gate in the front-centre, the ticket booth at the right, the sign at the left.
 */
export const YARD = {
  cx: 520,
  front: GY + 84,
  back: GY - 12,
  gate: { x0: 440, x1: 600, h: 215 },
  posts: [
    { x: 250, y: GY + 84, h: 215 },
    { x: 790, y: GY + 84, h: 215 },
    { x: 320, y: GY - 12, h: 170 },
    { x: 720, y: GY - 12, h: 170 },
    { x: 440, y: GY + 84, h: 240 },
    { x: 600, y: GY + 84, h: 240 },
  ],
  runs: {
    fl: { a: [250, GY + 84], b: [440, GY + 84], ha: 215, n: 5 },
    fr: { a: [600, GY + 84], b: [790, GY + 84], ha: 215, n: 5 },
    lw: { a: [250, GY + 84], b: [320, GY - 12], ha: 215, hb: 170, n: 3 },
    rw: { a: [790, GY + 84], b: [720, GY - 12], ha: 215, hb: 170, n: 3 },
    bk: { a: [320, GY - 12], b: [720, GY - 12], ha: 170, n: 10 },
  },
  crater: { x: 520, y: GY + 6, rx: 250, ry: 44 },
  gem: { x: 520, y: GY + 34, s: 1.4, tilt: 4 },
  booth: { x: 930, y: GY + 112, s: 1.25 },
  sign: { x: 190, y: GY + 140, w: 360, h: 330 },
  queueY: GY + 132,
};

export const WORLD_DEFS = `
  ${FX_DEFS}
  <linearGradient id="g-night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070707"/><stop offset=".6" stop-color="#262626"/><stop offset="1" stop-color="#4b4b4b"/></linearGradient>
  <linearGradient id="g-day" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f6f6"/><stop offset="1" stop-color="#bcbcbc"/></linearGradient>
  <linearGradient id="g-pave" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a5a5a"/><stop offset="1" stop-color="#262626"/></linearGradient>
  <linearGradient id="g-pave-d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9b9b9"/><stop offset="1" stop-color="#6d6d6d"/></linearGradient>
  <linearGradient id="g-beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity=".05"/></linearGradient>
  <radialGradient id="g-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <radialGradient id="g-spot" cx=".5" cy=".3" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <radialGradient id="g-hall" cx=".5" cy=".55" r=".75"><stop offset="0" stop-color="#5c5c5c"/><stop offset="1" stop-color="#101010"/></radialGradient>
  <radialGradient id="g-hole" cx=".5" cy=".7" r=".8"><stop offset="0" stop-color="#4b4b4b"/><stop offset=".6" stop-color="#171717"/><stop offset="1" stop-color="#050505"/></radialGradient>
  <linearGradient id="g-room" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b4b4b4"/><stop offset="1" stop-color="#8c8c8c"/></linearGradient>
  <pattern id="p-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0 L0 12" stroke="#111" stroke-width="1.6" opacity=".3"/></pattern>
  <pattern id="p-hazard" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="40" height="40" fill="#e8e8e8"/><rect width="20" height="40" fill="#161616"/></pattern>
  <pattern id="p-paper" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M0 0 H26 M0 0 V26" stroke="#222" stroke-width="1.2" opacity=".18"/><circle cx="13" cy="13" r="2.4" fill="#222" opacity=".16"/></pattern>
`;

/* ---------------------------------------------------------------- skies */

function stars(seed, n = 70, x0 = -1200, x1 = 2480, y0 = -1500, y1 = 360) {
  const rand = rng(seed);
  let s = '';
  for (let i = 0; i < n * 3; i++) {
    const x = x0 + rand() * (x1 - x0);
    const y = y0 + rand() * (y1 - y0);
    const r = 1.2 + rand() * 2.2;
    s += i % 9 === 0 ? `<path d="M${x.toFixed(0)} ${(y - 7).toFixed(0)} L${(x + 2).toFixed(0)} ${(y - 2).toFixed(0)} L${(x + 7).toFixed(0)} ${y.toFixed(0)} L${(x + 2).toFixed(0)} ${(y + 2).toFixed(0)} L${x.toFixed(0)} ${(y + 7).toFixed(0)} L${(x - 2).toFixed(0)} ${(y + 2).toFixed(0)} L${(x - 7).toFixed(0)} ${y.toFixed(0)} L${(x - 2).toFixed(0)} ${(y - 2).toFixed(0)}Z" fill="#fff"/>` : `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#fff" opacity="${(0.5 + rand() * 0.5).toFixed(2)}"/>`;
  }
  return s;
}

export function nightSky(id, { moon = [1040, 130] } = {}) {
  return `<rect x="-3600" y="-2600" width="7600" height="3400" fill="url(#g-night)"/>${stars(9, 45, -3000, 3400, -2400, 360)}
    <circle cx="${moon[0]}" cy="${moon[1]}" r="130" fill="url(#g-glow)" opacity=".5"/><circle cx="${moon[0]}" cy="${moon[1]}" r="52" fill="#f2f2f2" ${S} stroke-width="3" stroke="#bbb"/>
    <path d="M${moon[0] - 20} ${moon[1] - 22} a14 14 0 0 1 20 6 M${moon[0] + 10} ${moon[1] + 12} a10 10 0 0 1 12 -4" fill="none" stroke="#bbb" stroke-width="4"/>
    <g data-t="${id}.ringplanet" opacity=".95"><ellipse cx="120" cy="150" rx="52" ry="52" fill="#aaa" ${S} stroke-width="3" stroke="#666"/><ellipse cx="120" cy="150" rx="92" ry="16" fill="none" stroke="#ddd" stroke-width="6" transform="rotate(-18 120 150)"/></g>`;
}

function cloud(x, y, s, id) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><g ${id ? `data-t="${id}"` : ''}>
    <path d="M-70 20 C-96 20 -96 -12 -66 -12 C-64 -40 -22 -48 -8 -26 C10 -50 56 -36 50 -8 C84 -8 88 20 58 20Z" fill="#fff" ${S} stroke-width="4"/>
  </g></g>`;
}

export function daySky(id) {
  return `<rect x="-1400" y="-1800" width="4200" height="2600" fill="url(#g-day)"/>
    <circle cx="1080" cy="120" r="150" fill="url(#g-glow)"/><circle cx="1080" cy="120" r="54" fill="#fff" stroke="#bbb" stroke-width="3"/>
    ${cloud(200, 140, 1.4, `${id}.cloudA`)}${cloud(640, 80, 1.0, `${id}.cloudB`)}${cloud(930, 270, 0.9, `${id}.cloudC`)}
    <g opacity=".95"><ellipse cx="420" cy="260" rx="40" ry="40" fill="#e4e4e4" ${S} stroke-width="3"/><ellipse cx="420" cy="260" rx="70" ry="12" fill="none" stroke="#999" stroke-width="5" transform="rotate(-18 420 260)"/></g>`;
}

/* ---------------------------------------------------------------- ground */

/** The plaza in front of the museum. `day` lightens it. */
export function plaza({ day = false, top = GY - 22 } = {}) {
  const rand = rng(77);
  let pebbles = '';
  for (let i = 0; i < 40; i++) {
    const x = -1000 + rand() * 3400;
    const y = top + 24 + rand() * 120;
    pebbles += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(5 + rand() * 11).toFixed(0)}" ry="${(2 + rand() * 4).toFixed(0)}" fill="#${day ? '555' : '999'}" opacity=".35"/>`;
  }
  return `<path d="M-3600 ${top} L4200 ${top} L4200 1600 L-3600 1600Z" fill="url(#${day ? 'g-pave-d' : 'g-pave'})" ${S} stroke-width="5"/>${pebbles}
    <path d="M-1000 ${top + 52} L2400 ${top + 52} M-1000 ${top + 110} L2400 ${top + 110}" fill="none" stroke="${day ? '#444' : '#888'}" stroke-width="2" opacity=".28"/>`;
}

/** The impact crater (back lip + hollow); draw `craterFront` AFTER whatever sits in it. */
export function craterBack(id, { x = CRATER.x, y = GY + 6, rx = CRATER.rx, ry = CRATER.ry, day = false } = {}) {
  return `<g data-t="${id}.crater" transform="translate(${x} ${y})">
    <ellipse cx="0" cy="0" rx="${rx + 36}" ry="${ry + 12}" fill="${day ? '#8a8a8a' : '#3a3a3a'}" ${S} stroke-width="5"/>
    <ellipse cx="0" cy="8" rx="${rx}" ry="${ry}" fill="#0c0c0c" ${S} stroke-width="5"/>
    <ellipse cx="0" cy="30" rx="${rx * 0.7}" ry="${ry * 0.55}" fill="#000" opacity=".7"/>
  </g>`;
}
export function craterFront(id, { x = CRATER.x, y = GY + 6, rx = CRATER.rx, ry = CRATER.ry, day = false } = {}) {
  const rand = rng(5);
  let rocks = '';
  for (let i = 0; i < 16; i++) {
    const a = Math.PI * (0.06 + 0.88 * (i / 15));
    const px = Math.cos(a) * (rx + 24 + rand() * 20) * (i % 2 ? 1 : 1.02);
    const py = Math.sin(a) * (ry + 12) + 6;
    rocks += `<path transform="translate(${px.toFixed(0)} ${py.toFixed(0)}) rotate(${(rand() * 60).toFixed(0)})" d="M-14 4 L-8 -10 L8 -12 L16 2 L4 12Z" fill="${day ? '#9e9e9e' : '#5d5d5d'}" ${S} stroke-width="3.6"/>`;
  }
  return `<g transform="translate(${x} ${y})">
    <path d="M${-rx - 34} 4 Q0 ${ry * 2 + 44} ${rx + 34} 4 Q0 ${ry * 2 + 10} ${-rx - 34} 4Z" fill="${day ? '#8a8a8a' : '#444'}" ${S} stroke-width="5"/>${rocks}
  </g>`;
}

/* ---------------------------------------------------------------- the museum from outside */

function rivets(x0, y, x1, step = 46) {
  let s = '';
  for (let x = x0; x <= x1; x += step) s += `<circle cx="${x}" cy="${y}" r="4.6" fill="#d0d0d0" ${S} stroke-width="2"/>`;
  return s;
}

/** Security camera on a bracket. Head rotates about its mount: target `${id}.camHead`; LED `${id}.led`. */
export function securityCam(id, x, y) {
  return `<g transform="translate(${x} ${y})">
    <path d="M0 -36 L0 0 L-34 0" fill="none" ${S} stroke-width="12"/><path d="M0 -36 L0 0 L-34 0" fill="none" stroke="#999" stroke-width="5"/>
    <g data-t="${id}.camHead"><g transform="translate(-6 0)">
      <rect x="-14" y="-4" width="74" height="40" rx="8" fill="#cfcfcf" ${S} stroke-width="5"/>
      <rect x="52" y="2" width="18" height="28" rx="3" fill="#2a2a2a" ${S} stroke-width="4"/><circle cx="62" cy="16" r="8" fill="#555" ${S} stroke-width="3"/><circle cx="60" cy="13" r="2.6" fill="#fff"/>
      <circle data-t="${id}.led" cx="2" cy="8" r="5" fill="#fff" ${S} stroke-width="2.4"/>
    </g></g>
  </g>`;
}

/** The searchlight cone; origin = lamp. Rotate `${id}.beam` to sweep. Points toward +x, widening. */
export function searchlight(id, len = 1300) {
  return `<g transform="translate(0 0)">
    <path d="M-30 -22 L40 -28 L40 28 L-30 22Z" fill="#555" ${S} stroke-width="5"/><circle cx="40" cy="0" r="30" fill="#fff" ${S} stroke-width="5"/><circle cx="40" cy="0" r="16" fill="#f4f4f4"/>
    <g data-t="${id}.beam"><path d="M44 -26 L${len} -330 L${len} 330 L44 26Z" fill="url(#g-beam)" opacity=".5"/></g>
  </g>`;
}

/** The ordinary door the thief ignores (so we can see him ignore it). */
function plainDoor(id, x) {
  return `<g transform="translate(${x} ${GY})">
    <rect x="-64" y="-196" width="128" height="196" fill="#8a8a8a" ${S} stroke-width="6"/>
    <rect x="-48" y="-180" width="96" height="180" fill="#c4c4c4" ${S} stroke-width="5"/>
    <rect x="-34" y="-164" width="68" height="62" fill="#262626" ${S} stroke-width="4"/><path d="M-30 -112 L-10 -160 M0 -112 L24 -160" stroke="#555" stroke-width="7" opacity=".7"/>
    <circle cx="30" cy="-86" r="7" fill="#eee" ${S} stroke-width="3"/>
    <path d="M-30 -60 L30 -60 M-30 -44 L30 -44" stroke="#777" stroke-width="3"/>
    <rect x="-52" y="-4" width="104" height="10" fill="#4a4a4a" ${S} stroke-width="3"/>
    <g data-t="${id}.closed"><path d="M-14 -150 L-14 -138 M14 -150 L14 -138" stroke="${INK}" stroke-width="3"/><rect x="-30" y="-140" width="60" height="38" rx="3" fill="#fff" ${S} stroke-width="3.6" transform="translate(0 6)"/><text x="0" y="-111" font-size="12" font-weight="900" text-anchor="middle" fill="${INK}" font-family="Impact, sans-serif" letter-spacing="1">CLOSED</text></g>
  </g>`;
}

/**
 * The museum wall from outside. o: { hole: bool (draw the dark opening), day: bool, door: bool, cam: bool }.
 * `${id}.sweep` is the searchlight; `${id}.cam*` the camera.
 */
export function museumFront(id, { hole = false, day = false, door = true, cam = true, light = true } = {}) {
  const sky = day ? daySky(id) : nightSky(id);
  const wallFill = day ? '#9a9a9a' : '#5a5a5a';
  const seam = day ? '#4a4a4a' : '#2c2c2c';
  let panels = '';
  for (let x = -1100; x < 2400; x += 320) {
    panels += `<path d="M${x} 168 L${x} ${GY - 4}" stroke="${seam}" stroke-width="7"/>${rivets(x + 24, 190, x + 300, 55)}${rivets(x + 24, 330, x + 300, 55)}${rivets(x + 24, 470, x + 300, 55)}`;
  }
  const crenel = [...Array(54)].map((_, i) => `<rect x="${-1200 + i * 70}" y="60" width="42" height="52" fill="${day ? '#8a8a8a' : '#4a4a4a'}" ${S} stroke-width="5"/>`).join('');
  const holeSvg = hole
    ? `<g>
        <path d="M${WALL.cx - WALL.hw - 8} ${GY} L${WALL.cx - WALL.hw - 8} ${WALL.top + 60} Q${WALL.cx - WALL.hw - 8} ${WALL.top - 14} ${WALL.cx} ${WALL.top - 14} Q${WALL.cx + WALL.hw + 8} ${WALL.top - 14} ${WALL.cx + WALL.hw + 8} ${WALL.top + 60} L${WALL.cx + WALL.hw + 8} ${GY}Z" fill="${INK}" stroke="${INK}" stroke-width="6"/>
        <path d="M${WALL.cx - WALL.hw} ${GY} L${WALL.cx - WALL.hw} ${WALL.top + 60} Q${WALL.cx - WALL.hw} ${WALL.top} ${WALL.cx} ${WALL.top} Q${WALL.cx + WALL.hw} ${WALL.top} ${WALL.cx + WALL.hw} ${WALL.top + 60} L${WALL.cx + WALL.hw} ${GY}Z" fill="url(#g-hole)"/>
        <path d="M${WALL.cx - WALL.hw - 8} ${WALL.top + 90} l-10 -8 l8 -12 M${WALL.cx + WALL.hw + 8} ${WALL.top + 120} l10 -6 l-6 -14" stroke="${INK}" stroke-width="4" fill="none"/>
      </g>`
    : '';
  return `${sky}
    <path d="M-1200 ${GY - 220} L-1200 ${GY} L2480 ${GY} L2480 ${GY - 260} L2200 ${GY - 260} L2200 ${GY - 340} L1900 ${GY - 340} L1900 ${GY - 220} L1500 ${GY - 220} L1500 ${GY - 300} L1260 ${GY - 300} L1260 ${GY - 200} L700 ${GY - 200} L700 ${GY - 410} L520 ${GY - 410} L520 ${GY - 250} L-300 ${GY - 250} L-300 ${GY - 330} L-560 ${GY - 330} L-560 ${GY - 220}Z" fill="${day ? '#bdbdbd' : '#1b1b1b'}" opacity=".0"/>
    <rect x="-1200" y="108" width="3680" height="${GY - 108}" fill="${wallFill}" ${S} stroke-width="6"/>
    <rect x="-1200" y="108" width="3680" height="${GY - 108}" fill="url(#p-hatch)"/>
    ${panels}
    <path d="M-1200 392 L2480 392 M-1200 172 L2480 172" stroke="${seam}" stroke-width="9"/>
    ${crenel}
    <rect x="-1200" y="108" width="3680" height="62" fill="${day ? '#6d6d6d' : '#2f2f2f'}" ${S} stroke-width="6"/>
    <text x="640" y="156" font-size="50" font-weight="900" text-anchor="middle" fill="#f4f4f4" font-family="Georgia, serif" letter-spacing="14">${NAMES.museum}</text>
    ${[300, 980, 1560].map((x) => `<g transform="translate(${x} 228)"><rect x="-26" y="-30" width="52" height="80" rx="26" fill="#0e0e0e" ${S} stroke-width="5"/><path d="M-9 -26 L-9 46 M9 -26 L9 46 M-24 0 L24 0" stroke="#8a8a8a" stroke-width="4"/></g>`).join('')}
    <rect x="-1200" y="${GY - 38}" width="3680" height="38" fill="url(#p-hazard)" ${S} stroke-width="5"/>
    ${holeSvg}
    ${door ? plainDoor(id, 250) : ''}
    ${cam ? securityCam(id, 1040, 214) : ''}
    ${light ? `<g transform="translate(1180 110)"><g data-t="${id}.sweep" style="transform:rotate(128deg)">${searchlight(id)}</g></g>` : ''}
    ${plaza({ day })}`;
}

/** Extreme close-up of the wall (the arc scene). */
export function wallClose(id) {
  let s = '';
  for (let y = 40; y < 720; y += 160) s += `<path d="M0 ${y} L1280 ${y}" stroke="#222" stroke-width="9"/>${rivets(30, y + 28, 1260, 70)}`;
  return `<rect width="1280" height="720" fill="#555"/><rect width="1280" height="720" fill="url(#p-hatch)"/>${s}
    <path d="M640 0 L640 720" stroke="#222" stroke-width="9"/>
    <path d="M120 300 l60 20 l-16 40 M980 120 l50 -10 l14 36" stroke="#2c2c2c" stroke-width="5" fill="none" opacity=".7"/>`;
}

/* ---------------------------------------------------------------- the cut-away diorama */

/** x of the slab (the wall's cross-section) and the gap through it, in SECTION view. */
export const SEC = { slabX: 1020, slabW: 150, gapTop: GY - 256, ceil: -140 };

function paintings(seed, x0, x1, y0 = 190, k = 1) {
  const rand = rng(seed);
  let s = '';
  for (let x = x0; x < x1; x += 330) {
    const w = (120 + rand() * 90) * k;
    const h = (130 + rand() * 90) * k;
    const y = y0 + rand() * 40;
    s += `<g transform="translate(${x + rand() * 80} ${y})"><rect x="${-w / 2}" y="0" width="${w}" height="${h}" fill="#e2e2e2" ${S} stroke-width="8"/>
      <rect x="${-w / 2 + 12}" y="12" width="${w - 24}" height="${h - 24}" fill="#${rand() > 0.5 ? '8f8f8f' : 'bcbcbc'}" stroke="${INK}" stroke-width="3"/>
      <path d="M${-w / 2 + 12} ${h - 12} L${-w * 0.1} ${h * 0.4} L${w * 0.1} ${h * 0.7} L${w / 2 - 12} ${h * 0.3} L${w / 2 - 12} ${h - 12}Z" fill="#444"/>
      <circle cx="${-w * 0.22}" cy="${h * 0.3}" r="${w * 0.08}" fill="#fff"/></g>`;
  }
  return s;
}

/**
 * Cut-away of the museum. Gallery on the left (floor GY, ceiling SEC.ceil), the wall's cross-section slab at
 * SEC.slabX with an opening at floor level (SEC.gapTop..GY), night plaza on the right.
 * Draw order: back = `sectionBack(id)`, then actors, then `sectionFront()` (slab pieces + ceiling lip that overlap actors).
 */
export function sectionBack(id) {
  const { slabX, slabW, ceil } = SEC;
  return `${nightSky(id, { moon: [1900, 120] })}
    <rect x="-3000" y="${ceil}" width="${slabX + 3000}" height="${GY - ceil}" fill="url(#g-room)"/>
    <rect x="-3000" y="${ceil}" width="${slabX + 3000}" height="${GY - ceil}" fill="url(#p-paper)"/>
    <rect x="-3000" y="${GY - 90}" width="${slabX + 3000}" height="16" fill="#6d6d6d" ${S} stroke-width="4"/>
    <rect x="-3000" y="${ceil}" width="${slabX + 3000}" height="26" fill="#dedede" ${S} stroke-width="4"/>
    ${paintings(14, -2800, slabX - 200)}${paintings(21, -2700, slabX - 200, -70, 1.25)}
    ${[-2500, -1900, -1300, -700, -100, 420].map((x) => `<g transform="translate(${x} ${ceil + 26})"><rect x="-26" y="0" width="52" height="${GY - ceil - 26}" fill="#cacaca" ${S} stroke-width="5"/><rect x="-36" y="0" width="72" height="18" fill="#e8e8e8" ${S} stroke-width="4"/><rect x="-36" y="${GY - ceil - 44}" width="72" height="18" fill="#e8e8e8" ${S} stroke-width="4"/><path d="M-10 20 L-10 ${GY - ceil - 46} M10 20 L10 ${GY - ceil - 46}" stroke="#8a8a8a" stroke-width="3"/></g>`).join('')}
    ${[-2400, -1800, -1200, -600, 0, 560].map((x) => `<g transform="translate(${x} ${ceil + 26})"><path d="M0 0 L0 22" stroke="${INK}" stroke-width="4"/><path d="M-30 22 L30 22 L20 40 L-20 40Z" fill="#fff" ${S} stroke-width="4"/></g>`).join('')}
    ${plaza({ top: GY })}
    <rect x="-3000" y="${GY}" width="${slabX + 3000}" height="1500" fill="#7e7e7e" ${S} stroke-width="5"/>
    <path d="M-3000 ${GY + 40} L${slabX} ${GY + 40} M-3000 ${GY + 96} L${slabX} ${GY + 96}" stroke="#555" stroke-width="3"/>`;
}

/** The part of the diorama that overlaps actors: wall slab (above and below the opening) and the roof edge. */
export function sectionFront() {
  const { slabX, slabW, gapTop, ceil } = SEC;
  const x1 = slabX + slabW;
  return `<g>
    <rect x="${slabX}" y="-1800" width="${slabW}" height="${gapTop + 1800}" fill="#6a6a6a" ${S} stroke-width="7"/>
    <rect x="${slabX}" y="-1800" width="${slabW}" height="${gapTop + 1800}" fill="url(#p-hatch)"/>
    <path d="M${slabX + 40} -1800 L${slabX + 40} ${gapTop} M${slabX + 110} -1800 L${slabX + 110} ${gapTop}" stroke="#2c2c2c" stroke-width="5" opacity=".7"/>
    <rect x="${slabX}" y="${GY}" width="${slabW}" height="300" fill="#5a5a5a" ${S} stroke-width="7"/>
    <path d="M${slabX} ${gapTop} L${x1} ${gapTop}" stroke="#d0d0d0" stroke-width="5"/>
    <path d="M${slabX + 2} ${gapTop} l16 22 l8 -16 M${x1 - 2} ${gapTop} l-14 18 l-10 -14" stroke="${INK}" stroke-width="4" fill="none"/>
    <rect x="${slabX - 600}" y="${ceil - 70}" width="${slabW + 600}" height="70" fill="#4e4e4e" ${S} stroke-width="7"/>
  </g>`;
}

/* ---------------------------------------------------------------- the gallery, front on */

export function galleryFront(id) {
  const floor = (() => {
    let s = '';
    for (let i = 0; i < 12; i++) {
      const y = 520 + i * i * 0.9 + i * 6;
      s += `<path d="M-300 ${y} L1580 ${y}" stroke="#111" stroke-width="2" opacity=".4"/>`;
    }
    for (let x = -1200; x <= 2480; x += 120) s += `<path d="M${640 + (x - 640) * 0.35} 520 L${x} 740" stroke="#111" stroke-width="2" opacity=".35"/>`;
    return s;
  })();
  return `<rect x="-1400" y="-100" width="3500" height="900" fill="url(#g-hall)"/>
    <rect x="-1400" y="520" width="3500" height="300" fill="#2a2a2a"/>${floor}
    ${[-120, 1400].map((x) => `<g transform="translate(${x} 0)"><rect x="-90" y="-100" width="180" height="640" fill="#4a4a4a" ${S} stroke-width="7"/><path d="M-50 -100 L-50 540 M50 -100 L50 540" stroke="#222" stroke-width="5"/><rect x="-110" y="500" width="220" height="40" fill="#6a6a6a" ${S} stroke-width="6"/></g>`).join('')}
    ${[200, 1080].map((x) => `<g transform="translate(${x} 150)"><rect x="-90" y="0" width="180" height="150" fill="#5c5c5c" ${S} stroke-width="7"/><rect x="-74" y="14" width="148" height="122" fill="#2e2e2e"/><path d="M-60 120 L-20 50 L10 90 L40 40 L60 120Z" fill="#7a7a7a"/></g>`).join('')}
    <path d="M300 -20 L980 -20 L1180 560 L100 560Z" fill="url(#g-spot)"/>
    ${[640].map((x) => `<g transform="translate(${x} 0)"><rect x="-26" y="-20" width="52" height="46" fill="#bbb" ${S} stroke-width="5"/><path d="M-30 26 L30 26 L18 40 L-18 40Z" fill="#fff" ${S} stroke-width="4"/></g>`).join('')}`;
}

/* ---------------------------------------------------------------- the road to the fence */

/** Far horizon for the despair scene: a long winding road to a dim town with a lit FENCE sign. */
export function distantRoad(id) {
  return `${nightSky(id, { moon: [260, 110] })}
    <path d="M-1400 400 L-1100 372 L-900 396 L-640 350 L-420 398 L-240 380 L-60 408 L100 390 L260 412 L470 384 L700 410 L980 386 L1240 408 L1560 380 L1880 404 L2200 372 L2480 400 L2480 430 L-1400 430Z" fill="#161616" stroke="#222" stroke-width="3"/>
    ${[1130, 1170, 1240].map((x, i) => `<g transform="translate(${x} ${420 - i * 4})"><rect x="-22" y="-${40 + i * 18}" width="44" height="${40 + i * 18}" fill="#0c0c0c" stroke="#333" stroke-width="3"/><rect x="-12" y="-${30 + i * 18}" width="9" height="12" fill="#ddd"/><rect x="4" y="-${30 + i * 18}" width="9" height="12" fill="#bbb"/></g>`).join('')}
    <g transform="translate(1060 428)"><rect x="-40" y="-52" width="80" height="52" fill="#0e0e0e" stroke="#444" stroke-width="3"/><path d="M-46 -52 L0 -84 L46 -52Z" fill="#0a0a0a" stroke="#444" stroke-width="3"/>
      <rect x="-16" y="-34" width="14" height="22" fill="#e8e8e8"/>
      <g data-t="${id}.neon"><rect x="-66" y="-120" width="132" height="34" rx="4" fill="#0a0a0a" stroke="#fff" stroke-width="3"/><text y="-94" font-size="26" font-weight="900" text-anchor="middle" fill="#fff" font-family="Impact, sans-serif" letter-spacing="6">${TEXT.fence}</text><path d="M0 -86 L0 -52" stroke="#fff" stroke-width="3"/></g>
      <circle cx="0" cy="-105" r="60" fill="url(#g-glow)" opacity=".5"/></g>
    <path d="M-1400 ${GY - 22} L2800 ${GY - 22} L2800 900 L-1400 900Z" fill="url(#g-pave)"/>
    <path d="M300 ${GY - 22} L1010 432 L1112 432 L1160 ${GY - 22}Z" fill="#3a3a3a" ${S} stroke-width="4"/>
    <path d="M730 ${GY - 22} L1060 436" stroke="#ccc" stroke-width="5" stroke-dasharray="26 22" opacity=".8"/>
    <path d="M-1000 ${GY + 52} L2400 ${GY + 52} M-1000 ${GY + 110} L2400 ${GY + 110}" fill="none" stroke="#888" stroke-width="2" opacity=".28"/>`;
}

/* ---------------------------------------------------------------- the apartment */

export function apartment(id) {
  const rand = rng(41);
  let stains = '';
  for (let i = 0; i < 6; i++) stains += `<ellipse cx="${(100 + rand() * 1000).toFixed(0)}" cy="${(80 + rand() * 360).toFixed(0)}" rx="${(30 + rand() * 50).toFixed(0)}" ry="${(14 + rand() * 24).toFixed(0)}" fill="#111" opacity=".07"/>`;
  return `<rect x="-400" y="-200" width="2100" height="900" fill="#b9b9b9"/>
    <rect x="-400" y="-200" width="2100" height="900" fill="url(#p-paper)"/>${stains}
    <path d="M820 -40 L820 300 L880 340 L880 -40Z" fill="#999" opacity=".6"/>
    <path d="M700 40 Q740 90 706 140" fill="none" stroke="#777" stroke-width="3"/>
    <rect x="-400" y="${GY - 24}" width="2100" height="300" fill="#6e6e6e" ${S} stroke-width="5"/>
    <path d="M-400 ${GY + 30} L1700 ${GY + 30} M-400 ${GY + 90} L1700 ${GY + 90}" stroke="#444" stroke-width="3"/>
    <rect x="-400" y="${GY - 70}" width="2100" height="48" fill="#8a8a8a" ${S} stroke-width="4"/>
    <g transform="translate(250 130)"><rect x="-130" y="0" width="260" height="290" fill="#222" ${S} stroke-width="9"/><rect x="-118" y="12" width="236" height="266" fill="#050505"/>
      <g data-t="${id}.stars">${[[-70, 60], [30, 100], [80, 50], [-30, 170], [60, 200], [-84, 230], [90, 150]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.4" fill="#fff"/>`).join('')}<circle cx="-30" cy="50" r="22" fill="#eee"/></g>
      <path d="M0 12 L0 278 M-118 145 L118 145" stroke="#bbb" stroke-width="9"/><rect x="-142" y="262" width="284" height="20" fill="#a8a8a8" ${S} stroke-width="5"/>
      <path d="M-118 12 L-60 12 L-118 90Z M118 12 L60 12 L118 90Z" fill="#cfcfcf" ${S} stroke-width="3"/></g>
    <g transform="translate(980 150) rotate(-4)"><rect x="-70" y="-8" width="140" height="96" fill="#e0e0e0" ${S} stroke-width="8"/><rect x="-58" y="4" width="116" height="72" fill="#bdbdbd" stroke="${INK}" stroke-width="3"/>
      <path d="M-50 70 L-20 30 L0 54 L22 22 L50 70Z" fill="#555"/><path d="M-56 -8 L56 -8" stroke="#777" stroke-width="3"/>
      <rect x="-66" y="108" width="132" height="64" rx="6" fill="#d8d8d8" ${S} stroke-width="5" transform="rotate(5 0 140)"/><text x="0" y="148" font-size="15" font-weight="900" text-anchor="middle" fill="${INK}" font-family="Impact, sans-serif" transform="rotate(5 0 140)" letter-spacing="1">WANTED</text></g>
    <g transform="translate(1090 ${GY - 62})"><path d="M-22 0 L-18 -64 L18 -64 L22 0Z" fill="#8a8a8a" ${S} stroke-width="5"/><ellipse cx="0" cy="-64" rx="18" ry="6" fill="#222"/><path d="M-26 -40 L26 -40" stroke="#555" stroke-width="3"/><path d="M-6 -30 L6 -30" stroke="#fff" stroke-width="2"/></g>
    <g transform="translate(520 ${GY - 70})"><g data-t="${id}.drip"><path d="M0 -330 Q-6 -300 0 -292 Q6 -300 0 -330Z" fill="#fff" ${S} stroke-width="3"/></g></g>
    <g transform="translate(500 ${GY - 70})"><path d="M-40 0 L-34 -52 L34 -52 L40 0Z" fill="#8a8a8a" ${S} stroke-width="5"/><ellipse cx="0" cy="-52" rx="34" ry="9" fill="#222" ${S} stroke-width="4"/><path d="M-30 -30 L30 -30" stroke="#555" stroke-width="3"/></g>`;
}

/** Armchair, origin = floor centre. `armchairBack` (draw before the thief) has the cushion and arms; `armchairFront` is just the skirt and feet. */
export function armchairBack() {
  return `<g><path d="M-120 0 L-130 -190 Q-130 -250 -70 -250 L70 -250 Q130 -250 130 -190 L120 0Z" fill="#5a5a5a" ${S} stroke-width="7"/>
    <path d="M-100 -200 Q0 -230 100 -200" fill="none" stroke="#8a8a8a" stroke-width="5"/>
    <circle cx="-60" cy="-190" r="7" fill="#aaa" ${S} stroke-width="3"/><circle cx="0" cy="-200" r="7" fill="#aaa" ${S} stroke-width="3"/><circle cx="60" cy="-190" r="7" fill="#aaa" ${S} stroke-width="3"/>
    <path d="M-136 -118 Q-136 -140 -112 -140 L-96 -140 L-96 -20 L-136 -20Z" fill="#4a4a4a" ${S} stroke-width="7"/><path d="M136 -118 Q136 -140 112 -140 L96 -140 L96 -20 L136 -20Z" fill="#4a4a4a" ${S} stroke-width="7"/>
    <path d="M-124 -80 L124 -80 L130 -30 L-130 -30Z" fill="#767676" ${S} stroke-width="7"/><path d="M-110 -72 L110 -72" stroke="#a8a8a8" stroke-width="4"/>
  </g>`;
}
export function armchairFront() {
  return `<g><path d="M-132 -34 L132 -34 L128 2 L-128 2Z" fill="#454545" ${S} stroke-width="7"/><path d="M-118 -20 L118 -20" stroke="#222" stroke-width="3"/>
    <path d="M-116 2 L-116 16 M116 2 L116 16" stroke="${INK}" stroke-width="12"/></g>`;
}

/** A footstool for the seated thief. Origin = floor centre. */
export function footstool() {
  return `<g><rect x="-52" y="-52" width="104" height="38" rx="10" fill="#8a8a8a" ${S} stroke-width="6"/><path d="M-40 -40 L40 -40" stroke="#b6b6b6" stroke-width="4"/><path d="M-40 -14 L-40 0 M40 -14 L40 0" stroke="${INK}" stroke-width="9"/></g>`;
}
