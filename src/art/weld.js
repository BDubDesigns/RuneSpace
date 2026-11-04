/**
 * Welding gear and the things welded with it. Grayscale, ink-outlined, like the rest of src/art.
 *
 *   torch(id, extra)        handheld gas torch. Grip at origin, nozzle toward +x; `TORCH_TIP` is the nozzle tip.
 *                           `extra` (markup) is drawn at the tip, so an arc flare passed in moves with the torch.
 *   gasCart(id)             two-tank welding trolley, origin = ground contact between wheel and tanks
 *   post(h)                 ornamental fence post with a ball finial, origin = base centre
 *   pickets(w, h, n)        a run of spear-topped pickets, origin = bottom-left
 *   rails(w)                two horizontal rails w/ rivets, origin = bottom-left of the run (rails sit at fence height)
 *   scroll(id, s)           decorative iron curl (spiral) - `${id}.line` is a path with pathLength 1 for drawing on
 *   gate(id, w, h)          double gate with an arch; leaves `${id}.L` / `${id}.R` hinge at their outer edge
 *   fenceRun({a, b, ha, hb, n})  pickets + rails along a world-space line (wrap + clip-reveal it)
 *   booth(id)               ticket booth { back, front } (draw back, the clerk, then front), origin = base centre
 *   signboard(id, lines)    low admission sign standing on the ground -> { html, lineY, w, h }
 *   plate(id, w, h, lines)  riveted steel plate with stencilled text lines, origin = centre
 */
import { INK } from './props.js';

const S = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;
const SERIF = "Georgia, 'Times New Roman', serif";
const STENCIL = "Impact, 'Arial Black', 'Arial Narrow Bold', sans-serif";

export const TORCH_TIP = { x: 124, y: 0 };

export function torch(id, extra = '') {
  return `<g>
    <path d="M-6 7 Q-30 40 -74 30 Q-110 22 -130 48" fill="none" ${S} stroke-width="11"/><path d="M-6 7 Q-30 40 -74 30 Q-110 22 -130 48" fill="none" stroke="#6b6b6b" stroke-width="5"/>
    <rect x="-16" y="-10" width="52" height="20" rx="8" fill="#4a4a4a" ${S} stroke-width="4.6"/>
    <path d="M-6 -6 L-6 6 M4 -6 L4 6 M14 -6 L14 6 M24 -6 L24 6" stroke="#8a8a8a" stroke-width="2.4"/>
    <rect x="2" y="-22" width="9" height="14" rx="3" fill="#e2e2e2" ${S} stroke-width="3.4"/><rect x="18" y="-22" width="9" height="14" rx="3" fill="#bdbdbd" ${S} stroke-width="3.4"/>
    <path d="M34 -5 L98 -3 L98 3 L34 5Z" fill="#c9c9c9" ${S} stroke-width="4"/>
    <path d="M36 -3 L96 -1.5" stroke="#fff" stroke-width="2" opacity=".8"/>
    <path d="M96 -7 L112 -4 L112 4 L96 7Z" fill="#6f6f6f" ${S} stroke-width="3.6"/>
    <path d="M112 -3 L124 -1 L124 1 L112 3Z" fill="#2c2c2c" ${S} stroke-width="2.6"/>
    <g transform="translate(${TORCH_TIP.x} ${TORCH_TIP.y})">${extra}</g>
    <g data-t="${id}.pilot" style="opacity:0"><path d="M126 0 L150 -5 Q164 0 150 5Z" fill="#fff" ${S} stroke-width="3"/></g>
  </g>`;
}

export function gasCart(id) {
  const tank = (x, tone, label) => `<g transform="translate(${x} 0)">
      <path d="M-20 -26 L-20 -150 Q-20 -176 0 -178 Q20 -176 20 -150 L20 -26Z" fill="${tone}" ${S} stroke-width="5"/>
      <path d="M-13 -34 L-13 -150" stroke="#fff" stroke-width="4" opacity=".6"/>
      <rect x="-8" y="-192" width="16" height="16" rx="3" fill="#8a8a8a" ${S} stroke-width="4"/><circle cx="0" cy="-198" r="9" fill="#e0e0e0" ${S} stroke-width="3.4"/>
      <rect x="-20" y="-118" width="40" height="24" fill="#f2f2f2" ${S} stroke-width="3"/><text y="-100" font-size="15" font-weight="900" text-anchor="middle" fill="${INK}" font-family="${STENCIL}">${label}</text>
    </g>`;
  return `<g data-t="${id}.body">
    <path d="M-42 -20 L-98 -122 Q-112 -138 -96 -142" fill="none" ${S} stroke-width="9"/>
    <path d="M-48 -18 L48 -18" ${S} stroke-width="9"/>
    ${tank(-16, '#cfcfcf', 'O2')}${tank(22, '#8e8e8e', 'AC')}
    <path d="M-40 -88 L40 -88" ${S} stroke-width="6"/><path d="M-40 -88 L40 -88" stroke="#bbb" stroke-width="2.4"/>
    <g transform="translate(0 -30)"><g data-t="${id}.wheel"><circle r="28" fill="#2c2c2c" ${S} stroke-width="5.6"/><circle r="18" fill="#bcbcbc" ${S} stroke-width="3.6"/><path d="M-18 0 L18 0 M0 -18 L0 18" ${S} stroke-width="3"/><circle r="5" fill="${INK}"/></g></g>
  </g>`;
}

export function post(h = 260) {
  return `<g>
    <rect x="-13" y="${-h}" width="26" height="${h}" fill="#4a4a4a" ${S} stroke-width="5"/>
    <path d="M-6 ${-h + 14} L-6 -8" stroke="#bbb" stroke-width="4" opacity=".7"/>
    <rect x="-20" y="${-h + 24}" width="40" height="12" rx="3" fill="#6a6a6a" ${S} stroke-width="4"/>
    <rect x="-20" y="-30" width="40" height="12" rx="3" fill="#6a6a6a" ${S} stroke-width="4"/>
    <circle cx="0" cy="${-h - 14}" r="19" fill="#d8d8d8" ${S} stroke-width="5"/><path d="M-9 ${-h - 22} Q-4 ${-h - 30} 4 ${-h - 28}" fill="none" stroke="#fff" stroke-width="4"/>
    <path d="M-8 ${-h - 32} L0 ${-h - 52} L8 ${-h - 32}Z" fill="#d8d8d8" ${S} stroke-width="4"/>
  </g>`;
}

export function pickets(w = 220, h = 190, n = 8) {
  const gap = w / n;
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = gap * (i + 0.5);
    s += `<path d="M${x - 6} 0 L${x - 6} ${-h + 22} L${x} ${-h} L${x + 6} ${-h + 22} L${x + 6} 0Z" fill="#3c3c3c" ${S} stroke-width="4.2"/><path d="M${x - 2.4} ${-h + 28} L${x - 2.4} -8" stroke="#bbb" stroke-width="2.4" opacity=".7"/>`;
  }
  return `<g>${s}</g>`;
}

export function rails(w = 220, h = 190) {
  const r = (y) => `<rect x="0" y="${y - 8}" width="${w}" height="16" rx="4" fill="#5a5a5a" ${S} stroke-width="4.4"/><rect x="2" y="${y - 6}" width="${w - 4}" height="5" rx="2" fill="#c8c8c8" opacity=".6"/>`;
  const rivets = (y) => [...Array(Math.max(2, Math.round(w / 55)))].map((_, i) => `<circle cx="${(i + 0.5) * (w / Math.max(2, Math.round(w / 55)))}" cy="${y}" r="3" fill="#ddd" stroke="${INK}" stroke-width="1.4"/>`).join('');
  return `<g>${r(-h * 0.2)}${r(-h * 0.72)}${rivets(-h * 0.2)}${rivets(-h * 0.72)}
    <path d="M0 ${-h * 0.72} Q${w * 0.25} ${-h * 0.98} ${w * 0.5} ${-h * 0.72} Q${w * 0.75} ${-h * 0.46} ${w} ${-h * 0.72}" fill="none" ${S} stroke-width="7"/>
    <path d="M0 ${-h * 0.72} Q${w * 0.25} ${-h * 0.98} ${w * 0.5} ${-h * 0.72} Q${w * 0.75} ${-h * 0.46} ${w} ${-h * 0.72}" fill="none" stroke="#bdbdbd" stroke-width="2.4"/></g>`;
}

/**
 * A run of fence along a line in world coordinates (not origin-relative): spear-topped pickets plus two rails.
 * a/b = [x, y] ground points, ha/hb = fence heights at each end (so side runs can taper), n pickets.
 * The returned markup is meant to be wrapped in one `<g data-t>` and revealed with a clip-path.
 */
export function fenceRun({ a, b, ha = 200, hb = ha, n = 8, dark = '#3c3c3c' }) {
  const at = (t) => ({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, h: ha + (hb - ha) * t });
  let pk = '';
  for (let i = 0; i < n; i++) {
    const p = at((i + 0.5) / n);
    const w = 6 * (p.h / 200) + 1.5;
    pk += `<path d="M${(p.x - w).toFixed(1)} ${p.y.toFixed(1)} L${(p.x - w).toFixed(1)} ${(p.y - p.h + 24).toFixed(1)} L${p.x.toFixed(1)} ${(p.y - p.h).toFixed(1)} L${(p.x + w).toFixed(1)} ${(p.y - p.h + 24).toFixed(1)} L${(p.x + w).toFixed(1)} ${p.y.toFixed(1)}Z" fill="${dark}" ${S} stroke-width="3.8"/><path d="M${(p.x - w * 0.35).toFixed(1)} ${(p.y - p.h + 30).toFixed(1)} L${(p.x - w * 0.35).toFixed(1)} ${(p.y - 8).toFixed(1)}" stroke="#bbb" stroke-width="2" opacity=".7"/>`;
  }
  const rail = (k) => {
    const p0 = at(0);
    const p1 = at(1);
    return `<path d="M${p0.x} ${p0.y - p0.h * k} L${p1.x} ${p1.y - p1.h * k}" ${S} stroke-width="14"/><path d="M${p0.x} ${p0.y - p0.h * k} L${p1.x} ${p1.y - p1.h * k}" stroke="#7a7a7a" stroke-width="7"/><path d="M${p0.x} ${p0.y - p0.h * k - 2} L${p1.x} ${p1.y - p1.h * k - 2}" stroke="#d6d6d6" stroke-width="2"/>`;
  };
  let scrolls = '';
  for (let i = 0; i < n; i++) {
    const p = at((i + 0.5) / n);
    const q = at((i + 1) / n);
    const cx = (p.x + q.x) / 2;
    const cy = (p.y + q.y) / 2 - ((p.h + q.h) / 2) * 0.72;
    if (i < n - 1) scrolls += `<circle cx="${cx.toFixed(1)}" cy="${(cy - 14 * (p.h / 200)).toFixed(1)}" r="${(9 * (p.h / 200)).toFixed(1)}" fill="none" ${S} stroke-width="4"/>`;
  }
  return `<g>${pk}${rail(0.2)}${rail(0.72)}${scrolls}</g>`;
}

/** A spiral flourish. The stroke path is `pathLength=1` so a dash-offset cue draws it on. */
export function scroll(id, s = 1) {
  const d = 'M0 0 C40 -4 70 -40 54 -74 C38 -106 -6 -100 -14 -64 C-20 -36 8 -22 22 -36 C32 -46 24 -62 12 -58';
  return `<g transform="scale(${s})">
    <path d="${d}" fill="none" stroke="${INK}" stroke-width="22" stroke-linecap="round"/>
    <path data-t="${id}.line" d="${d}" pathLength="1" fill="none" stroke="#cfcfcf" stroke-width="12" stroke-linecap="round" stroke-dasharray="1 1" style="stroke-dashoffset:1"/>
  </g>`;
}

/** Wrought-iron gate: each leaf hinges at its OUTER edge (x = -w/2 and x = +w/2); scaleX(.2) swings it open. */
export function gate(id, w = 200, h = 230) {
  const leaf = (side) => {
    const x0 = side < 0 ? 0 : -w / 2;
    let bars = '';
    for (let i = 0; i < 5; i++) {
      const x = x0 + (w / 2) * ((i + 0.5) / 5);
      bars += `<path d="M${x} -10 L${x} ${-h + 40}" ${S} stroke-width="9"/><path d="M${x} -10 L${x} ${-h + 40}" stroke="#444" stroke-width="4.4"/><path d="M${x - 5} ${-h + 40} L${x} ${-h + 22} L${x + 5} ${-h + 40}Z" fill="#444" ${S} stroke-width="3"/>`;
    }
    return `<g transform="translate(${side * (w / 2)} 0)"><g data-t="${id}.${side < 0 ? 'L' : 'R'}">
      <rect x="${x0}" y="${-h + 56}" width="${w / 2}" height="12" rx="3" fill="#585858" ${S} stroke-width="4"/>
      <rect x="${x0}" y="-52" width="${w / 2}" height="12" rx="3" fill="#585858" ${S} stroke-width="4"/>
      ${bars}
      <circle cx="${x0 + (w / 2) * (side < 0 ? 0.5 : 0.5)}" cy="${-h * 0.5}" r="14" fill="none" ${S} stroke-width="8"/>
      <circle cx="${x0 + (w / 2) * 0.5}" cy="${-h * 0.5}" r="14" fill="none" stroke="#d6d6d6" stroke-width="3.2"/>
    </g></g>`;
  };
  return `<g>${leaf(-1)}${leaf(1)}</g>`;
}

export function booth(id) {
  const back = `<g>
    <rect x="-96" y="-322" width="192" height="322" fill="#6d6d6d" ${S} stroke-width="6"/>
    <rect x="-76" y="-258" width="152" height="150" fill="#262626" ${S} stroke-width="5"/>
    <path d="M-76 -108 L-36 -258 M-20 -108 L32 -258" stroke="#3a3a3a" stroke-width="10" opacity=".8"/>
  </g>`;
  const front = `<g>
    <path d="M-96 -108 L96 -108 L96 0 L-96 0Z" fill="#a2a2a2" ${S} stroke-width="6"/>
    <path d="M-80 -92 L-80 -14 M-30 -92 L-30 -14 M20 -92 L20 -14 M70 -92 L70 -14" stroke="#6a6a6a" stroke-width="3.4"/>
    <rect x="-112" y="-124" width="224" height="22" rx="5" fill="#d6d6d6" ${S} stroke-width="5.4"/>
    <path d="M-120 -326 L120 -326 L134 -262 L-134 -262Z" fill="#f4f4f4" ${S} stroke-width="6"/>
    ${[-100, -60, -20, 20, 60, 100].map((x, i) => `<path d="M${x - 20} -326 L${x + 20} -326 L${x + 22 + (x > 0 ? 3 : -3)} -262 L${x - 22 + (x > 0 ? 3 : -3)} -262Z" fill="#3a3a3a" opacity="${i % 2 ? 0 : 1}"/>`).join('')}
    <path d="M-134 -262 Q-117 -246 -100 -262 Q-84 -246 -67 -262 Q-50 -246 -33 -262 Q-17 -246 0 -262 Q17 -246 33 -262 Q50 -246 67 -262 Q84 -246 100 -262 Q117 -246 134 -262" fill="#f4f4f4" ${S} stroke-width="4.4"/>
    <rect x="-86" y="-372" width="172" height="40" rx="6" fill="#1b1b1b" ${S} stroke-width="5.4"/>
    <text y="-342" font-size="28" font-weight="900" text-anchor="middle" fill="#f4f4f4" font-family="${SERIF}" letter-spacing="4">TICKETS</text>
    <g data-t="${id}.bell"><circle cx="70" cy="-136" r="10" fill="#e8e8e8" ${S} stroke-width="3.6"/><path d="M64 -136 L76 -136" stroke="${INK}" stroke-width="2"/></g>
  </g>`;
  return { back, front };
}

/**
 * Low, wide admission sign standing on the ground (origin = ground centre). `lines` are lettered top to bottom;
 * the last one is stencilled (the price). Line i sits at y = -h + 62 + i * step so scenes can aim a torch at them.
 * Returns { html, lineY: [..] (local y of each baseline), w, h }.
 */
export function signboard(id, lines = ['THE NEBULA HEART', 'EMERALD', '5 CREDITS ADMISSION'], { w = 440, h = 300 } = {}) {
  const step = (h - 90) / Math.max(1, lines.length - 1);
  const lineY = lines.map((_, i) => -h + 70 + i * step);
  const text = lines
    .map((t, i) => {
      const last = i === lines.length - 1;
      const size = last ? 34 : i === 0 ? 40 : 56;
      return `<g data-t="${id}.l${i}"><text y="${lineY[i] + (last ? 0 : 6)}" font-size="${size}" font-weight="900" text-anchor="middle" fill="${INK}" font-family="${last ? STENCIL : SERIF}" letter-spacing="${last ? 3 : 2}">${t}</text></g>`;
    })
    .join('');
  const html = `<g>
    <rect x="${-w / 2 + 40}" y="${-60}" width="20" height="60" fill="#5a5a5a" ${S} stroke-width="5"/><rect x="${w / 2 - 60}" y="${-60}" width="20" height="60" fill="#5a5a5a" ${S} stroke-width="5"/>
    <g data-t="${id}.face">
      <rect x="${-w / 2}" y="${-h}" width="${w}" height="${h - 20}" rx="10" fill="#f2f2f2" ${S} stroke-width="8"/>
      <rect x="${-w / 2 + 14}" y="${-h + 14}" width="${w - 28}" height="${h - 48}" rx="4" fill="none" stroke="${INK}" stroke-width="3"/>
      ${text}
      ${[[-w / 2 + 26, -h + 28], [w / 2 - 26, -h + 28], [-w / 2 + 26, -48], [w / 2 - 26, -48]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#bbb" ${S} stroke-width="2.4"/>`).join('')}
    </g>
  </g>`;
  return { html, lineY, w, h };
}

/** Riveted steel plate with stencilled text lines (origin = centre). Text is one `data-t` group per line (`${id}.t0...`). */
export function plate(id, w = 440, h = 280, lines = ['OPEN', 'DAILY'], size = 104) {
  const rv = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]].map(([a, b]) => `<circle cx="${a * (w / 2 - 22)}" cy="${b * (h / 2 - 22)}" r="7" fill="#d4d4d4" ${S} stroke-width="3"/>`).join('');
  const gap = size * 1.02;
  const y0 = -((lines.length - 1) * gap) / 2 + size * 0.34;
  return `<g>
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="9" fill="#8a8a8a" ${S} stroke-width="8"/>
    <rect x="${-w / 2 + 6}" y="${-h / 2 + 6}" width="${w - 12}" height="${(h - 12) * 0.3}" rx="5" fill="#d0d0d0" opacity=".55"/>
    <rect x="${-w / 2 + 16}" y="${-h / 2 + 16}" width="${w - 32}" height="${h - 32}" rx="4" fill="none" stroke="#2a2a2a" stroke-width="3.2"/>
    ${rv}
    ${lines.map((t, i) => `<g data-t="${id}.t${i}"><text y="${y0 + i * gap}" font-size="${size}" font-weight="900" text-anchor="middle" fill="${INK}" font-family="${STENCIL}" letter-spacing="5" stroke="#eee" stroke-width="2" paint-order="stroke">${t}</text></g>`).join('')}
  </g>`;
}

/** A tiny drawstring "SWAG" sack: far too small for a giant Emerald. Origin = the grip at the neck. */
export function swagSack() {
  return `<g>
    <path d="M-5 0 Q-30 4 -34 34 Q-32 56 0 58 Q32 56 34 34 Q30 4 5 0Z" fill="#cfcfcf" ${S} stroke-width="4.6"/>
    <path d="M-14 -4 Q0 -14 14 -4 L8 6 Q0 2 -8 6Z" fill="#9a9a9a" ${S} stroke-width="3.6"/>
    <path d="M-20 18 Q-24 36 -12 46" fill="none" stroke="#fff" stroke-width="4" opacity=".7" stroke-linecap="round"/>
    <text y="40" font-size="14" font-weight="900" text-anchor="middle" fill="${INK}" font-family="${STENCIL}" letter-spacing="1">SWAG</text>
  </g>`;
}
