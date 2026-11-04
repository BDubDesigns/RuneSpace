/**
 * Prospector rig: a rubber-hose cartoon character built from pivoted SVG groups.
 *
 *   root ─ shadow
 *        └ bob ─ pack?, armB, legB, legF, torso, head ( hat, face states ), armF
 *
 * Origin of `root` = ground contact between the feet. Every moving part is a
 * `data-t="<id>.<part>"` group, animated around its local origin (hip, shoulder,
 * neck...). The returned object exposes a Track per part plus a few higher level
 * actions (face, walk, yap, shake) that emit cues into the shared cue list.
 *
 * Two characters ship with it ("pip" the round scruffy one, "rex" the tall
 * skinny one); `KINDS` is the place to add more for other films.
 */
import { Track } from '../acting.js';
import { INK } from './props.js';

const S = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;

const KINDS = {
  pip: { L: 46, T: 86, hip: 19, sh: 43, shY: 18, armL: 54, legW: 20, skin: '#ececec', face: [7, -39, 1.14] },
  rex: { L: 104, T: 98, hip: 13, sh: 30, shY: 14, armL: 78, legW: 14, skin: '#f4f4f4', face: [4, -55, 1.0] },
};

export const FACES = ['normal', 'glance', 'shock', 'greed', 'angry', 'plot', 'ko', 'sleep', 'smug', 'cheer', 'sad'];

/* ---------------------------------------------------------------- faces */

function faceArt(name, id, skin) {
  const E = (cx, rx = 9, ry = 11, pr = 4.2, px = 2.5, py = 1) =>
    `<ellipse cx="${cx}" cy="0" rx="${rx}" ry="${ry}" fill="#fff" ${S} stroke-width="4"/><circle cx="${cx + px}" cy="${py}" r="${pr}" fill="${INK}"/>`;
  const lid = (cx, cover = 0) =>
    `<path d="M${cx - 9.6} ${-1 + cover} A9.6 10.4 0 0 1 ${cx + 9.6} ${-1 + cover}Z" fill="${skin}" ${S} stroke-width="3.6"/>`;
  const brow = (d, w = 5.5) => `<path d="${d}" fill="none" ${S} stroke-width="${w}"/>`;
  const star = (cx) =>
    `<path d="M${cx} -10 L${cx + 3} -3 L${cx + 10} 0 L${cx + 3} 3 L${cx} 10 L${cx - 3} 3 L${cx - 10} 0 L${cx - 3} -3Z" fill="${INK}"/><circle cx="${cx - 4}" cy="-5" r="2.6" fill="#fff"/>`;
  switch (name) {
    case 'glance':
      return `${E(-13, 9, 11, 4.4, 3.8, 4.5)}${E(13, 9, 11, 4.4, 3.8, 4.5)}${brow('M-24 -17 Q-14 -22 -4 -16')}${brow('M4 -16 Q14 -22 24 -17')}
        <path d="M-8 30 Q0 27 8 30" fill="none" ${S} stroke-width="4.5"/>`;
    case 'shock':
      return `${E(-13, 13, 16.5, 2.8, 0, 0)}${E(13, 13, 16.5, 2.8, 0, 0)}${brow('M-29 -28 Q-15 -40 -3 -30')}${brow('M3 -30 Q15 -40 29 -28')}
        <ellipse cx="0" cy="37" rx="11" ry="15" fill="${INK}"/><ellipse cx="0" cy="45" rx="7" ry="5" fill="#9a9a9a"/>`;
    case 'greed':
      return `<ellipse cx="-13" cy="0" rx="12" ry="14" fill="#fff" ${S} stroke-width="4"/><ellipse cx="13" cy="0" rx="12" ry="14" fill="#fff" ${S} stroke-width="4"/>
        ${star(-13)}${star(13)}${brow('M-27 -20 Q-14 -32 -3 -22')}${brow('M3 -22 Q14 -32 27 -20')}
        <path d="M-20 24 Q0 60 20 24 Q0 31 -20 24Z" fill="${INK}"/><path d="M-17 25 Q0 33 17 25 L14 32 Q0 38 -14 32Z" fill="#fff"/>
        <path d="M13 40 q5 9 0 15 q-5 -6 0 -15Z" fill="#fff" ${S} stroke-width="2.6"/>`;
    case 'angry':
      return `<ellipse cx="-13" cy="1" rx="8.5" ry="7" fill="#fff" ${S} stroke-width="4"/><ellipse cx="13" cy="1" rx="8.5" ry="7" fill="#fff" ${S} stroke-width="4"/>
        <circle cx="-11" cy="2" r="3.6" fill="${INK}"/><circle cx="15" cy="2" r="3.6" fill="${INK}"/>
        ${brow('M-28 -22 L-5 -8', 8)}${brow('M5 -8 L28 -22', 8)}
        <g transform="translate(0 24)"><g data-t="${id}.mouth"><path d="M-18 0 L18 0 L14 26 Q0 33 -14 26Z" fill="${INK}"/><path d="M-15 0 L15 0 L14 7 L-14 7Z" fill="#fff"/><ellipse cx="0" cy="23" rx="8" ry="5" fill="#9a9a9a"/></g></g>`;
    case 'plot':
      return `<path d="M-23 2 Q-13 -9 -3 2 Q-13 8 -23 2Z" fill="#fff" ${S} stroke-width="3.8"/><path d="M3 2 Q13 -9 23 2 Q13 8 3 2Z" fill="#fff" ${S} stroke-width="3.8"/>
        <circle cx="-9" cy="2.5" r="3.4" fill="${INK}"/><circle cx="17" cy="2.5" r="3.4" fill="${INK}"/>
        ${brow('M-28 -18 L-4 -7', 7)}${brow('M4 -7 L28 -18', 7)}
        <path d="M-22 22 Q0 56 22 22 Q0 31 -22 22Z" fill="${INK}"/><path d="M-18 24 Q0 31 18 24 L15 30 Q0 37 -15 30Z" fill="#fff"/>
        <path d="M-24 20 Q-28 24 -26 30 M24 20 Q28 24 26 30" fill="none" ${S} stroke-width="3.4"/>`;
    case 'ko':
      return `<path d="M-21 -8 L-5 8 M-5 -8 L-21 8 M5 -8 L21 8 M21 -8 L5 8" fill="none" ${S} stroke-width="6.5"/>
        <ellipse cx="0" cy="33" rx="10" ry="6.5" fill="${INK}"/><path d="M-2 35 Q-2 54 8 49 Q10 40 6 35Z" fill="#c4c4c4" ${S} stroke-width="3"/>`;
    case 'sleep':
      return `<path d="M-23 0 Q-13 10 -3 0 M3 0 Q13 10 23 0" fill="none" ${S} stroke-width="5.5"/>
        ${brow('M-24 -14 Q-14 -18 -4 -13', 4.5)}${brow('M4 -13 Q14 -18 24 -14', 4.5)}
        <ellipse cx="3" cy="33" rx="6.5" ry="8" fill="${INK}"/>`;
    case 'smug':
      return `${E(-13, 9, 10, 4, 3.5, 2)}${E(13, 9, 10, 4, 3.5, 2)}${lid(-13, 4)}${lid(13, 4)}
        ${brow('M-25 -16 Q-14 -20 -4 -15')}${brow('M4 -22 Q15 -29 25 -21')}<path d="M-8 30 Q8 41 22 25" fill="none" ${S} stroke-width="4.8"/>`;
    case 'cheer':
      return `<path d="M-23 5 Q-13 -9 -3 5 M3 5 Q13 -9 23 5" fill="none" ${S} stroke-width="6"/>
        <path d="M-20 22 Q0 62 20 22Z" fill="${INK}" ${S} stroke-width="3.6"/><ellipse cx="0" cy="41" rx="9" ry="5.5" fill="#b0b0b0"/>`;
    case 'sad':
      return `${E(-13, 9, 11, 4.4, 0, 3)}${E(13, 9, 11, 4.4, 0, 3)}${lid(-13, 2)}${lid(13, 2)}${brow('M-26 -10 L-6 -19')}${brow('M6 -19 L26 -10')}
        <path d="M-11 38 Q0 25 11 38" fill="none" ${S} stroke-width="4.8"/><path d="M-19 14 q-4 9 0 14 q4 -5 0 -14Z" fill="#fff" ${S} stroke-width="2.4"/>`;
    default: // normal: weary, half-lidded
      return `${E(-13, 9, 10)}${E(13, 9, 10)}${lid(-13)}${lid(13)}${brow('M-24 -15 Q-14 -19 -4 -13')}${brow('M4 -13 Q14 -19 24 -15')}
        <path d="M-9 30 Q0 25 9 31" fill="none" ${S} stroke-width="4.5"/>`;
  }
}

/* ------------------------------------------------------------ body art */

function legArt(k, side) {
  const { L, legW } = k;
  const pants = side === 'pip' ? '#3e3e3e' : '#cfcfcf';
  const shoe = side === 'pip' ? INK : '#1a1a1a';
  const toe = side === 'pip' ? 26 : 34;
  return `<path d="M0 0 L0 ${L - 14}" ${S} stroke-width="${legW + 9}"/><path d="M0 0 L0 ${L - 14}" stroke="${pants}" stroke-width="${legW}" stroke-linecap="round"/>
    ${side === 'rex' ? `<path d="M-4 8 L-4 ${L - 20} M4 8 L4 ${L - 20}" stroke="#999" stroke-width="1.8"/>` : ''}
    <path d="M${-16} ${L - 2} Q${-16} ${L - 20} 0 ${L - 20} Q${toe - 6} ${L - 24} ${toe + 6} ${L - 8} Q${toe + 10} ${L + 1} ${toe} ${L + 1} L-12 ${L + 1} Q-16 ${L + 1} -16 ${L - 2}Z" fill="${shoe}" ${S} stroke-width="3"/>
    <path d="M-6 ${L - 14} Q4 ${L - 20} 16 ${L - 15}" fill="none" stroke="#fff" stroke-width="2.6" opacity=".4" stroke-linecap="round"/>`;
}

function armArt(k, who, propMarkup, id, which) {
  const { armL } = k;
  const sleeve = who === 'pip' ? '#f0f0f0' : '#e4e4e4';
  return `<path d="M0 0 Q5 ${armL / 2} 0 ${armL - 6}" fill="none" ${S} stroke-width="17"/>
    <path d="M0 0 Q5 ${armL / 2} 0 ${armL - 6}" fill="none" stroke="${sleeve}" stroke-width="8" stroke-linecap="round"/>
    <g transform="translate(0 ${armL})"><g data-t="${id}.prop${which}">${propMarkup || ''}</g>
      <circle r="13.5" fill="#fff" ${S} stroke-width="4.5"/><path d="M-4 3 Q0 8 5 3" fill="none" stroke="#999" stroke-width="2"/></g>`;
}

function pipTorso(k) {
  return `<g transform="translate(0 ${-k.L})">
    <path d="M-34 0 C-56 -8 -56 -62 -34 -82 Q0 -96 34 -82 C56 -62 56 -8 34 0 Q0 8 -34 0Z" fill="#f0f0f0" ${S} stroke-width="5"/>
    <path d="M-36 -1 C-53 -8 -53 -42 -46 -54 Q0 -60 46 -54 C53 -42 53 -8 36 -1 Q0 7 -36 -1Z" fill="#3a3a3a" ${S} stroke-width="5"/>
    <path d="M-25 -55 L-22 -86 L22 -86 L25 -55Z" fill="#3a3a3a" ${S} stroke-width="5"/>
    <path d="M-22 -86 L-30 -90 M22 -86 L30 -90" ${S} stroke-width="5"/>
    <circle cx="-17" cy="-76" r="4" fill="#d9d9d9" ${S} stroke-width="2.4"/><circle cx="17" cy="-76" r="4" fill="#d9d9d9" ${S} stroke-width="2.4"/>
    <rect x="14" y="-40" width="22" height="20" rx="2" fill="#a9a9a9" stroke="#111" stroke-width="2.4" transform="rotate(5 25 -30)"/>
    <path d="M17 -37 L33 -37 M17 -23 L33 -23" stroke="#444" stroke-width="1.6" stroke-dasharray="3 2" transform="rotate(5 25 -30)"/>
    <path d="M-42 -30 Q-44 -18 -38 -10" fill="none" stroke="#777" stroke-width="3"/>
  </g>`;
}

function pipPack(k) {
  return `<g transform="translate(-50 ${-k.L - 66})">
    <path d="M-6 -4 L-30 -48 M2 -6 L-14 -56" ${S} stroke="#bdbdbd" stroke-width="8"/><path d="M-6 -4 L-30 -48 M2 -6 L-14 -56" stroke="#7b7b7b" stroke-width="2"/>
    <rect x="-24" y="-6" width="50" height="76" rx="14" fill="#6d6d6d" ${S} stroke-width="5"/>
    <path d="M-24 14 Q1 30 26 14" fill="#8a8a8a" ${S} stroke-width="4"/>
    <circle cx="1" cy="26" r="4" fill="#ddd" ${S} stroke-width="2"/>
  </g>`;
}

function rexTorso(k) {
  return `<g transform="translate(0 ${-k.L})">
    <path d="M-27 6 L-32 -78 Q-32 -98 -14 -98 L14 -98 Q32 -98 32 -78 L27 6Z" fill="#e6e6e6" ${S} stroke-width="5"/>
    <path d="M-12 -98 L0 -44 L12 -98 L22 -98 L0 -26 L-22 -98Z" fill="#2c2c2c" ${S} stroke-width="3.6"/>
    <path d="M-10 -96 L0 -78 L10 -96Z" fill="#fff" ${S} stroke-width="3"/>
    <path d="M-10 -92 L-22 -98 L-22 -86Z M10 -92 L22 -98 L22 -86Z" fill="${INK}"/><circle cx="0" cy="-92" r="4" fill="${INK}"/>
    <circle cx="0" cy="-52" r="3" fill="#fff"/><circle cx="0" cy="-36" r="3" fill="#fff"/><circle cx="0" cy="-20" r="3" fill="#fff"/>
    <path d="M-24 -52 Q-34 -40 -14 -34" fill="none" stroke="#555" stroke-width="2.4"/>
    <path d="M-27 6 L-40 22 L-20 12 M27 6 L40 22 L20 12" fill="#e6e6e6" ${S} stroke-width="4"/>
  </g>`;
}

function pipHead(id, skin) {
  return `<g>
    <circle cx="-38" cy="-34" r="10" fill="${skin}" ${S} stroke-width="4"/><circle cx="38" cy="-34" r="10" fill="${skin}" ${S} stroke-width="4"/>
    <ellipse cx="0" cy="-38" rx="40" ry="38" fill="${skin}" ${S} stroke-width="5"/>
    <path d="M-40 -28 C-56 6 -36 44 0 50 C36 44 56 6 40 -28 C28 -12 -28 -12 -40 -28Z" fill="#8c8c8c" ${S} stroke-width="5"/>
    <path d="M-30 6 Q-26 20 -30 30 M-14 14 Q-12 28 -16 38 M10 14 Q12 28 8 40 M26 4 Q28 18 24 28" fill="none" stroke="#3b3b3b" stroke-width="2.6" stroke-linecap="round"/>
    <ellipse cx="9" cy="-26" rx="11" ry="12" fill="#d6d6d6" ${S} stroke-width="4.5"/>
  </g>`;
}

function pipHat() {
  return `<ellipse cx="0" cy="0" rx="60" ry="12" fill="#cfcfcf" ${S} stroke-width="5"/>
    <path d="M-36 -2 C-42 -36 -14 -54 12 -52 C38 -50 44 -22 40 -2Z" fill="#e2e2e2" ${S} stroke-width="5"/>
    <path d="M12 -52 C36 -60 58 -46 62 -26 C50 -34 36 -36 24 -34Z" fill="#e2e2e2" ${S} stroke-width="4.5"/>
    <path d="M-38 -12 Q0 2 41 -12 L40 -3 Q0 13 -37 0Z" fill="#2e2e2e" ${S} stroke-width="3"/>
    <path d="M-14 -47 Q0 -38 14 -49" fill="none" ${S} stroke-width="3"/>
    <path d="M-52 4 L-46 10 L-52 14" fill="none" ${S} stroke-width="2.6"/>`;
}

function rexHead(id, skin) {
  return `<g>
    <circle cx="-27" cy="-40" r="8" fill="${skin}" ${S} stroke-width="4"/><circle cx="27" cy="-40" r="8" fill="${skin}" ${S} stroke-width="4"/>
    <ellipse cx="0" cy="-41" rx="28" ry="40" fill="${skin}" ${S} stroke-width="5"/>
    <path d="M4 -48 Q30 -36 24 -22 Q15 -16 9 -24Z" fill="#dcdcdc" ${S} stroke-width="4.5"/>
  </g>`;
}

const rexMustache = () =>
  `<path d="M-1 -32 Q-12 -42 -24 -36 Q-36 -44 -42 -30 Q-34 -34 -24 -27 Q-10 -26 -1 -27 Q10 -26 24 -27 Q34 -34 42 -30 Q36 -44 24 -36 Q12 -42 1 -32Z" fill="${INK}" ${S} stroke-width="2"/>`;

function rexHat() {
  return `<ellipse cx="0" cy="0" rx="42" ry="8" fill="#151515" ${S} stroke-width="5"/>
    <path d="M-29 -1 C-34 -44 34 -44 29 -1Z" fill="#232323" ${S} stroke-width="5"/>
    <path d="M-30 -9 Q0 3 30 -9 L29 -2 Q0 10 -29 -1Z" fill="#5d5d5d" ${S} stroke-width="3"/>
    <path d="M-17 -27 Q-8 -36 8 -33" fill="none" stroke="#9a9a9a" stroke-width="5" stroke-linecap="round"/>`;
}

function foldArt(k, who) {
  const w = who === 'pip' ? 44 : 32;
  const sleeve = who === 'pip' ? '#f0f0f0' : '#e4e4e4';
  return `<rect x="${-w}" y="-13" width="${w * 2}" height="26" rx="13" fill="${sleeve}" ${S} stroke-width="5"/>
    <path d="M${-w * 0.4} -11 L${w * 0.4} 11 M${w * 0.4} -11 L${-w * 0.4} 11" ${S} stroke-width="3" opacity=".55"/>
    <circle cx="${-w + 4}" cy="3" r="12" fill="#fff" ${S} stroke-width="4.2"/><circle cx="${w - 4}" cy="-3" r="12" fill="#fff" ${S} stroke-width="4.2"/>`;
}

/* --------------------------------------------------------------- the rig */

/**
 * @param {object[]} cues  shared cue list
 * @param {string} id      unique id prefix (e.g. "s04.pip")
 * @param {object} o       { kind: 'pip'|'rex', x, y, flip, scale, face, pack, props: { F, B } }
 */
export function prospector(cues, id, o = {}) {
  const kind = o.kind || 'pip';
  const k = KINDS[kind];
  const sc = o.scale ?? 1;
  const T = (part, pose) => new Track(cues, `${id}.${part}`, pose);

  const root = new Track(cues, id, { x: o.x ?? 0, y: o.y ?? 0, flip: o.flip ?? 1, sx: sc, sy: sc, rot: o.rot ?? 0 });
  const bob = T('bob');
  const torso = T('torso');
  const head = T('head');
  const hat = T('hat', { y: o.hatY ?? 0 });
  const armF = T('armF', { rot: o.armF ?? 0 });
  const armB = T('armB', { rot: o.armB ?? 0 });
  const legF = T('legF', { rot: o.legF ?? 0 });
  const legB = T('legB', { rot: o.legB ?? 0 });
  const shadow = T('shadow');
  const propF = T('propF');
  const propB = T('propB');

  const [fx, fy, fs] = k.face;
  const faces = FACES.map(
    (n) => `<g data-t="${id}.f.${n}" style="opacity:${n === (o.face || 'normal') ? 1 : 0}">${faceArt(n, id, k.skin)}</g>`
  ).join('');
  const faceGroup = `<g transform="translate(${fx} ${fy}) scale(${fs})">${faces}</g>`;
  const hatY = kind === 'pip' ? -64 : -76;

  const shoulderY = -k.L - k.T + k.shY;
  const foldGroup = `<g transform="translate(0 ${shoulderY + (kind === 'pip' ? 22 : 18)})"><g data-t="${id}.fold" style="opacity:0">${foldArt(k, kind)}</g></g>`;
  const body =
    kind === 'pip'
      ? `${o.pack ? pipPack(k) : ''}
         <g transform="translate(${-k.sh} ${shoulderY})"><g data-t="${id}.armB" style="${armB.css}">${armArt(k, kind, o.props?.B, id, 'B')}</g></g>
         <g transform="translate(${-k.hip} ${-k.L})"><g data-t="${id}.legB" style="${legB.css}">${legArt(k, kind)}</g></g>
         <g transform="translate(${k.hip} ${-k.L})"><g data-t="${id}.legF" style="${legF.css}">${legArt(k, kind)}</g></g>
         <g data-t="${id}.torso" style="${torso.css}">${pipTorso(k)}</g>
         <g transform="translate(0 ${-k.L - k.T + 6})"><g data-t="${id}.head" style="${head.css}">
           ${pipHead(id, k.skin)}${faceGroup}
           <g transform="translate(0 ${hatY})"><g data-t="${id}.hat" style="${hat.css}">${pipHat()}</g></g>
         </g></g>
         <g transform="translate(${k.sh} ${shoulderY})"><g data-t="${id}.armF" style="${armF.css}">${armArt(k, kind, o.props?.F, id, 'F')}</g></g>
         ${foldGroup}`
      : `<g transform="translate(${-k.sh} ${shoulderY})"><g data-t="${id}.armB" style="${armB.css}">${armArt(k, kind, o.props?.B, id, 'B')}</g></g>
         <g transform="translate(${-k.hip} ${-k.L})"><g data-t="${id}.legB" style="${legB.css}">${legArt(k, kind)}</g></g>
         <g transform="translate(${k.hip} ${-k.L})"><g data-t="${id}.legF" style="${legF.css}">${legArt(k, kind)}</g></g>
         <g data-t="${id}.torso" style="${torso.css}">${rexTorso(k)}</g>
         <g transform="translate(0 ${-k.L - k.T + 6})"><g data-t="${id}.head" style="${head.css}">
           ${rexHead(id, k.skin)}${faceGroup}${rexMustache()}
           <g transform="translate(0 ${hatY})"><g data-t="${id}.hat" style="${hat.css}">${rexHat()}</g></g>
         </g></g>
         <g transform="translate(${k.sh} ${shoulderY})"><g data-t="${id}.armF" style="${armF.css}">${armArt(k, kind, o.props?.F, id, 'F')}</g></g>
         ${foldGroup}`;

  const html = `<g data-t="${id}" class="mm-actor" style="${root.css}">
      <ellipse data-t="${id}.shadow" cx="0" cy="3" rx="${kind === 'pip' ? 62 : 54}" ry="11" fill="#000" opacity=".3"/>
      <g data-t="${id}.bob">${body}</g>
    </g>`;

  let faceNow = o.face || 'normal';

  const c = {
    id,
    kind,
    html,
    root,
    bob,
    torso,
    head,
    hat,
    armF,
    armB,
    legF,
    legB,
    shadow,
    propF,
    propB,
    dims: k,

    /** Swap the face expression at `at` (instant). */
    face(at, name) {
      if (name === faceNow) return c;
      cues.push({ at, dur: 1, target: `${id}.f.${faceNow}`, keyframes: [{ opacity: 1 }, { opacity: 0 }], easing: 'linear' });
      cues.push({ at, dur: 1, target: `${id}.f.${name}`, keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear' });
      faceNow = name;
      return c;
    },

    /** Flap the yelling mouth (face must be 'angry'). */
    yap(at, total, rate = 130) {
      const n = Math.max(1, Math.round(total / rate));
      cues.push({
        at,
        dur: total / n,
        iterations: n,
        direction: 'alternate',
        target: `${id}.mouth`,
        keyframes: [{ transform: 'scaleY(0.22)' }, { transform: 'scaleY(1)' }],
        easing: 'ease-in-out',
        reduce: 'skip',
      });
      return c;
    },

    /**
     * Walk to x over `dur` ms: root slides, legs/arms swing, body bobs.
     * Legs and arms rest at 0 when it ends.
     */
    walk(at, dur, toX, { stride = 560, amp = 26, swing = 16, bounce = 6, ease = 'linear', toY, noRoot = false } = {}) {
      const peaks = Math.max(2, Math.round(dur / (stride / 2)));
      const step = dur / (peaks + 1);
      const swingVals = (a) => {
        const v = [];
        for (let i = 1; i <= peaks; i++) v.push({ rot: (i % 2 ? 1 : -1) * a });
        v.push({ rot: 0 });
        return v;
      };
      const reduce = { reduce: 'skip' };
      const grid = (vals) => vals.map((v, i) => ({ o: (i + 1) / vals.length, ...v }));
      legF.keys(at, dur, grid(swingVals(amp)), { seg: 'ease-in-out', ease: 'linear', ...reduce });
      legB.keys(at, dur, grid(swingVals(-amp)), { seg: 'ease-in-out', ease: 'linear', ...reduce });
      if (swing) {
        armF.keys(at, dur, grid(swingVals(-swing)), { seg: 'ease-in-out', ease: 'linear', ...reduce });
        armB.keys(at, dur, grid(swingVals(swing)), { seg: 'ease-in-out', ease: 'linear', ...reduce });
      }
      const bobs = [];
      for (let i = 1; i <= (peaks + 1) * 2; i++) bobs.push({ y: i % 2 ? -bounce : 0 });
      bob.keys(at, dur, grid(bobs), { seg: 'ease-in-out', ease: 'linear', ...reduce });
      if (!noRoot) root.to(at, dur, { x: toX, ...(toY != null ? { y: toY } : {}) }, { ease, reduce: 'snap' });
      return c;
    },

    /** Quick squash-and-stretch on the whole body (pivot = feet). */
    squash(at, dur, sy = 0.82, sx = 1.14) {
      bob.keys(at, dur, [{ o: 0.4, sx, sy }, { o: 1, sx: 1, sy: 1 }], { ease: 'ease-out', reduce: 'skip' });
      return c;
    },

    /** Rattle the head left/right (anger, shivering). */
    shake(at, dur, deg = 4, rate = 70) {
      const n = Math.max(2, Math.round(dur / rate));
      head.keys(at, dur, grid2(n, (i) => ({ rot: (i % 2 ? 1 : -1) * deg })).concat([{ o: 1, rot: 0 }]), { ease: 'linear', reduce: 'skip' });
      return c;
    },

    /** Whole-body vibration (cutter in hand, rage). */
    vibrate(at, dur, px = 3, rate = 45) {
      const n = Math.max(2, Math.round(dur / rate));
      torso.keys(at, dur, grid2(n, (i) => ({ x: (i % 2 ? 1 : -1) * px, y: (i % 3 ? 0.5 : -0.5) * px })).concat([{ o: 1, x: 0, y: 0 }]), { ease: 'linear', reduce: 'skip' });
      return c;
    },

    /** Cross (or uncross) the arms over the chest. */
    fold(at, on = true) {
      const op = (target, a, b) => cues.push({ at, dur: 1, target, keyframes: [{ opacity: a }, { opacity: b }], easing: 'linear' });
      op(`${id}.fold`, on ? 0 : 1, on ? 1 : 0);
      op(`${id}.armF`, on ? 1 : 0, on ? 0 : 1);
      op(`${id}.armB`, on ? 1 : 0, on ? 0 : 1);
      return c;
    },

    /** Both arms and legs back to neutral. */
    rest(at, dur = 160) {
      [legF, legB, armF, armB].forEach((t) => t.to(at, dur, { rot: 0 }, { ease: 'ease-out' }));
      return c;
    },
  };
  return c;
}

function grid2(n, fn) {
  const out = [];
  for (let i = 1; i < n; i++) out.push({ o: i / n, ...fn(i) });
  return out;
}
