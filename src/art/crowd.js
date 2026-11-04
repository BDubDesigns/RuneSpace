/**
 * Background people: light-weight tourists for queues and crowds. Each is ONE tracked group (root) with a
 * `bob` child (for the shuffling walk) and a `head` child (to look up in awe), so a dozen of them stay cheap.
 *
 *   tourist(cues, id, { v, x, y, scale, flip })
 *     v = 0 camera-tourist, 1 lady with big hat, 2 kid with propeller cap, 3 little robot, 4 alien,
 *         5 big fellow with a backpack, 6 old gent with a cane (wraps around: v % 7)
 *     .html                 markup
 *     .root / .bob / .head  Tracks
 *     .walk(at, dur, toX)   shuffle to x (body hops, root slides); snaps in reduced motion
 *     .awe(at)              head tips back, mouth goes "oh", small hop
 *     .height               approx pixel height at scale 1 (use it to place labels)
 */
import { Track } from '../acting.js';
import { INK } from './props.js';

const S = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;

const LEG = (shoe = '#1a1a1a') => `<path d="M-14 -34 L-14 -6 M14 -34 L14 -6" ${S} stroke-width="17"/><path d="M-14 -34 L-14 -6 M14 -34 L14 -6" stroke="#555" stroke-width="9"/>
  <path d="M-26 0 Q-26 -12 -12 -12 L-2 -12 L-2 0Z M26 0 Q26 -12 12 -12 L2 -12 L2 0Z" fill="${shoe}" ${S} stroke-width="3.4"/>`;

const EYES = (cx = 0, y = -6, dx = 12) => `<ellipse cx="${cx - dx}" cy="${y}" rx="7.5" ry="9" fill="#fff" ${S} stroke-width="3"/><ellipse cx="${cx + dx}" cy="${y}" rx="7.5" ry="9" fill="#fff" ${S} stroke-width="3"/>
  <circle cx="${cx - dx + 2}" cy="${y + 1}" r="3.2" fill="${INK}"/><circle cx="${cx + dx + 2}" cy="${y + 1}" r="3.2" fill="${INK}"/>`;

const MOUTH = (y = 16) => `<path d="M-8 ${y} Q0 ${y + 5} 8 ${y}" fill="none" ${S} stroke-width="3.6"/>`;
const OH = (y = 16) => `<ellipse cx="0" cy="${y + 4}" rx="7" ry="9" fill="${INK}"/>`;

const DEFS = [
  // 0 camera tourist
  {
    h: 200,
    body: `<path d="M-30 -34 C-40 -80 -34 -118 -18 -126 L18 -126 C34 -118 40 -80 30 -34Z" fill="#ececec" ${S} stroke-width="4.6"/>
      <path d="M-34 -100 L34 -100 M-36 -84 L36 -84 M-34 -68 L34 -68 M-31 -52 L31 -52" stroke="#444" stroke-width="5" opacity=".7"/>
      <g transform="translate(0 -78)"><rect x="-22" y="-14" width="44" height="30" rx="5" fill="#2a2a2a" ${S} stroke-width="4"/><circle r="10" fill="#bbb" ${S} stroke-width="3.4"/><circle r="4" fill="${INK}"/></g>
      <path d="M-22 -126 L-8 -84 M22 -126 L8 -84" stroke="${INK}" stroke-width="4"/>`,
    head: (hd) => `<circle cx="0" cy="0" r="34" fill="#f1f1f1" ${S} stroke-width="4.6"/>${EYES(0, -4)}<g data-t="${hd}.m">${MOUTH(14)}</g><g data-t="${hd}.o" style="opacity:0">${OH(14)}</g>
      <ellipse cx="0" cy="-26" rx="52" ry="9" fill="#d6d6d6" ${S} stroke-width="4.4"/><path d="M-26 -26 C-30 -58 30 -58 26 -26Z" fill="#e2e2e2" ${S} stroke-width="4.4"/><path d="M-26 -32 Q0 -24 26 -32" fill="none" stroke="#444" stroke-width="6"/>`,
    top: -126,
  },
  // 1 lady
  {
    h: 215,
    body: `<path d="M-22 -112 C-20 -128 20 -128 22 -112 L52 -22 Q0 -10 -52 -22Z" fill="#cfcfcf" ${S} stroke-width="4.6"/>
      <path d="M-20 -106 L20 -106" stroke="#444" stroke-width="6"/>
      <path d="M-40 -64 Q0 -56 40 -64" fill="none" stroke="#fff" stroke-width="3" opacity=".7"/>
      <g transform="translate(40 -64)"><rect x="-4" y="-10" width="34" height="26" rx="6" fill="#444" ${S} stroke-width="4"/><path d="M0 -10 Q12 -26 24 -10" fill="none" ${S} stroke-width="3.4"/></g>`,
    head: (hd) => `<ellipse cx="0" cy="0" rx="30" ry="33" fill="#f4f4f4" ${S} stroke-width="4.6"/>${EYES(0, -2, 11)}<g data-t="${hd}.m">${MOUTH(15)}</g><g data-t="${hd}.o" style="opacity:0">${OH(15)}</g>
      <path d="M-22 -10 C-34 10 -30 26 -22 22 M22 -10 C34 10 30 26 22 22" fill="none" stroke="#555" stroke-width="5"/>
      <ellipse cx="0" cy="-26" rx="62" ry="12" fill="#222" ${S} stroke-width="4.6"/><path d="M-32 -28 C-38 -62 38 -62 32 -28Z" fill="#3a3a3a" ${S} stroke-width="4.6"/>
      <circle cx="-22" cy="-54" r="9" fill="#f2f2f2" ${S} stroke-width="3"/><circle cx="-8" cy="-60" r="7" fill="#bbb" ${S} stroke-width="3"/>`,
    top: -112,
  },
  // 2 kid
  {
    h: 140,
    body: `<path d="M-22 -30 C-28 -62 -22 -80 -12 -84 L12 -84 C22 -80 28 -62 22 -30Z" fill="#dedede" ${S} stroke-width="4.4"/><path d="M-24 -52 L24 -52 M-24 -66 L24 -66" stroke="#555" stroke-width="5"/>`,
    head: (hd) => `<circle cx="0" cy="0" r="30" fill="#f2f2f2" ${S} stroke-width="4.4"/>${EYES(0, -2, 10)}<g data-t="${hd}.m">${MOUTH(13)}</g><g data-t="${hd}.o" style="opacity:0">${OH(13)}</g>
      <path d="M-30 -14 C-26 -42 26 -42 30 -14Z" fill="#4a4a4a" ${S} stroke-width="4.4"/><path d="M-6 -36 L-6 -50 M-24 -52 L12 -48" ${S} stroke-width="4.4"/><path d="M-26 -52 Q-6 -58 14 -48" fill="none" stroke="#ddd" stroke-width="5"/>`,
    top: -84,
    legScale: 0.7,
  },
  // 3 robot
  {
    h: 205,
    body: `<rect x="-34" y="-122" width="68" height="84" rx="10" fill="#bdbdbd" ${S} stroke-width="4.6"/><rect x="-22" y="-108" width="44" height="30" rx="4" fill="#2a2a2a" ${S} stroke-width="3.4"/>
      <path d="M-14 -96 L-6 -96 M2 -96 L14 -96" stroke="#fff" stroke-width="3"/><circle cx="-14" cy="-56" r="5" fill="#eee" ${S} stroke-width="2.4"/><circle cx="14" cy="-56" r="5" fill="#777" ${S} stroke-width="2.4"/>`,
    head: (hd) => `<rect x="-30" y="-30" width="60" height="56" rx="10" fill="#d4d4d4" ${S} stroke-width="4.6"/><circle cx="-12" cy="-6" r="10" fill="#fff" ${S} stroke-width="3.4"/><circle cx="12" cy="-6" r="10" fill="#fff" ${S} stroke-width="3.4"/>
      <circle cx="-12" cy="-5" r="4" fill="${INK}"/><circle cx="12" cy="-5" r="4" fill="${INK}"/><g data-t="${hd}.m"><path d="M-12 14 L12 14" ${S} stroke-width="4"/></g><g data-t="${hd}.o" style="opacity:0"><rect x="-8" y="8" width="16" height="14" rx="3" fill="${INK}"/></g>
      <path d="M0 -30 L0 -52" ${S} stroke-width="4.4"/><circle cx="0" cy="-56" r="7" fill="#fff" ${S} stroke-width="3.4"/>`,
    top: -122,
  },
  // 4 alien
  {
    h: 190,
    body: `<path d="M-20 -34 C-26 -70 -20 -96 -8 -102 L8 -102 C20 -96 26 -70 20 -34Z" fill="#c4c4c4" ${S} stroke-width="4.4"/><path d="M-18 -74 L18 -74" stroke="#555" stroke-width="4"/>`,
    head: (hd) => `<path d="M-36 -2 C-44 -52 44 -52 36 -2 C30 26 -30 26 -36 -2Z" fill="#dadada" ${S} stroke-width="4.6"/>
      <ellipse cx="-15" cy="-4" rx="11" ry="16" fill="${INK}" transform="rotate(14 -15 -4)"/><ellipse cx="15" cy="-4" rx="11" ry="16" fill="${INK}" transform="rotate(-14 15 -4)"/>
      <circle cx="-17" cy="-9" r="3.4" fill="#fff"/><circle cx="13" cy="-9" r="3.4" fill="#fff"/>
      <g data-t="${hd}.m"><path d="M-7 18 Q0 22 7 18" fill="none" ${S} stroke-width="3.4"/></g><g data-t="${hd}.o" style="opacity:0"><ellipse cx="0" cy="20" rx="5" ry="7" fill="${INK}"/></g>
      <path d="M-14 -40 Q-22 -62 -30 -66 M14 -40 Q22 -62 30 -66" fill="none" ${S} stroke-width="4"/><circle cx="-31" cy="-68" r="6" fill="#fff" ${S} stroke-width="3"/><circle cx="31" cy="-68" r="6" fill="#fff" ${S} stroke-width="3"/>`,
    top: -102,
  },
  // 5 big fellow
  {
    h: 220,
    body: `<path d="M-52 -34 C-70 -90 -52 -134 -30 -142 L30 -142 C52 -134 70 -90 52 -34Z" fill="#e8e8e8" ${S} stroke-width="5"/>
      <path d="M-30 -128 L-30 -34 M30 -128 L30 -34" stroke="#555" stroke-width="6"/><circle cx="0" cy="-92" r="26" fill="#cfcfcf" opacity=".6"/>
      <rect x="40" y="-132" width="44" height="82" rx="14" fill="#6d6d6d" ${S} stroke-width="5"/><path d="M42 -108 Q62 -98 82 -108" fill="none" ${S} stroke-width="3.4"/>`,
    head: (hd) => `<circle cx="0" cy="0" r="35" fill="#f0f0f0" ${S} stroke-width="4.6"/>${EYES(0, -4, 12)}<g data-t="${hd}.m">${MOUTH(15)}</g><g data-t="${hd}.o" style="opacity:0">${OH(15)}</g>
      <path d="M-12 -48 Q0 -62 12 -48 L10 -34 L-10 -34Z" fill="#444" ${S} stroke-width="4"/>`,
    top: -142,
  },
  // 6 old gent
  {
    h: 205,
    body: `<path d="M-28 -34 C-34 -84 -28 -118 -14 -124 L14 -124 C28 -118 34 -84 28 -34Z" fill="#9a9a9a" ${S} stroke-width="4.6"/>
      <path d="M-10 -122 L0 -70 L10 -122" fill="#f2f2f2" ${S} stroke-width="3.4"/><path d="M44 -60 L44 -4" ${S} stroke-width="8"/><path d="M44 -60 L44 -4" stroke="#8a8a8a" stroke-width="3.4"/><path d="M44 -62 Q44 -82 62 -76" fill="none" ${S} stroke-width="8"/><path d="M44 -62 Q44 -82 62 -76" fill="none" stroke="#8a8a8a" stroke-width="3.4"/>`,
    head: (hd) => `<ellipse cx="0" cy="0" rx="30" ry="34" fill="#f2f2f2" ${S} stroke-width="4.6"/>${EYES(0, -4, 11)}
      <path d="M-24 14 Q0 8 24 14 Q14 24 0 22 Q-14 24 -24 14Z" fill="#cfcfcf" ${S} stroke-width="3.4"/><g data-t="${hd}.m"><path d="M-7 20 Q0 24 7 20" fill="none" ${S} stroke-width="3"/></g><g data-t="${hd}.o" style="opacity:0">${OH(15)}</g>
      <path d="M-30 -22 Q0 -30 30 -22 L28 -34 Q0 -48 -28 -34Z" fill="#2a2a2a" ${S} stroke-width="4.4"/><ellipse cx="0" cy="-30" rx="36" ry="7" fill="#2a2a2a" ${S} stroke-width="4.4"/>`,
    top: -124,
  },
];

export function tourist(cues, id, { v = 0, x = 0, y = 0, scale = 1, flip = 1 } = {}) {
  const d = DEFS[((v % DEFS.length) + DEFS.length) % DEFS.length];
  const root = new Track(cues, id, { x, y, sx: scale, sy: scale, flip });
  const bob = new Track(cues, `${id}.bob`);
  const head = new Track(cues, `${id}.head`);
  const ls = d.legScale || 1;
  const html = `<g data-t="${id}" style="${root.css}">
    <ellipse cx="0" cy="3" rx="34" ry="8" fill="#000" opacity=".28"/>
    <g data-t="${id}.bob" style="${bob.css}">
      <g transform="scale(1 ${ls})">${LEG()}</g>
      ${d.body}
      <g transform="translate(0 ${d.top - 28 * 0 - 34 * (ls === 1 ? 1 : 0.9)})"><g data-t="${id}.head" style="${head.css}">${d.head(id)}</g></g>
    </g>
  </g>`;
  let awed = false;
  const t = {
    id,
    html,
    root,
    bob,
    head,
    height: d.h * scale,
    walk(at, dur, toX, { ease = 'linear', step = 380, h = 7 } = {}) {
      const n = Math.max(1, Math.round(dur / step));
      bob.keys(at, dur / n, [{ o: 0.5, y: -h }, { o: 1, y: 0 }], { seg: 'ease-in-out', ease: 'linear', iterations: n, reduce: 'skip' });
      root.to(at, dur, { x: toX }, { ease, reduce: 'snap' });
      return t;
    },
    awe(at) {
      if (awed) return t;
      awed = true;
      const op = (target, a, b) => cues.push({ at, dur: 1, target, keyframes: [{ opacity: a }, { opacity: b }], easing: 'linear' });
      op(`${id}.m`, 1, 0);
      op(`${id}.o`, 0, 1);
      head.to(at, 260, { rot: -12 * flip }, { ease: 'ease-out' });
      bob.keys(at, 260, [{ o: 0.5, y: -14 }, { o: 1, y: 0 }], { ease: 'ease-out', reduce: 'skip' });
      return t;
    },
  };
  return t;
}
