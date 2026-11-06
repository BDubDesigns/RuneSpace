/**
 * 0-3 s. A customer carefully presents a single tiny bolt at the FedHex counter. The clerk accepts
 * it like a precious artifact. EVERY PARCEL MATTERS.
 */
import { prospector } from '../../../art/prospector.js';
import { Track, tween } from '../../../acting.js';
import { sparkle, rays } from '../../../fx/effects.js';
import { Camera, gripAt } from '../../../kit.js';
import { INK } from '../../../art/props.js';
import { TEXT } from '../config.js';
import { GROUND_Y, bolt, hexE, SERIF } from '../world.js';

export function counter(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: -120, y: GROUND_Y, scale: 1.55, face: 'normal', pack: true });
  const rex = prospector(cues, `${id}.rex`, { kind: 'rex', x: 900, y: GROUND_Y, scale: 1.5, flip: -1, face: 'normal' });

  // Pip walks up carrying his arm out, the bolt held in front of him.
  pip.walk(at(0), 1250, 380, { stride: 560, amp: 18, swing: 0, bounce: 5 });
  pip.armF.to(at(1000), 260, { rot: -78 }, { ease: 'ease-out', reduce: 'snap' });
  const hand = gripAt(pip, cues, at(1300), 'F');
  const boltT = new Track(cues, `${id}.bolt`, { x: hand.x + 20, y: hand.y - 4 });
  tween(cues, `${id}.bolt`, at(1250), 80, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
  boltT.to(at(1450), 420, { x: 760, y: 430 }, { ease: 'ease-in-out', reduce: 'snap' });
  boltT.to(at(1900), 380, { x: 790, y: 380, sx: 1.3, sy: 1.3 }, { ease: 'ease-out', reduce: 'snap' });
  // The clerk leans in, reverent, and the bolt is lifted as if it were a crown jewel.
  rex.armF.to(at(1350), 300, { rot: 70 }, { ease: 'ease-out', reduce: 'snap' });
  rex.face(at(1600), 'greed');
  rex.head.to(at(1800), 300, { rot: 8 }, { ease: 'ease-in-out', reduce: 'snap' });
  pip.face(at(1700), 'cheer');

  const fx = sparkle({ x: 790, y: 360, at: at(2000), dur: 800, r: 30, n: 3 }) + rays({ x: 790, y: 380, at: at(2000), n: 10, r0: 34, r1: 70, dur: 520, stroke: INK, width: 5, late: true });

  const bar = new Track(cues, `${id}.bar`, { x: 0, y: 40 });
  bar.to(at(1900), 320, { y: 0 }, { ease: 'ease-out', reduce: 'snap' });
  tween(cues, `${id}.bar`, at(1900), 200, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });

  const room = `<rect x="-300" y="-100" width="1880" height="760" fill="url(#fh-wall)"/>
    <g transform="translate(640 250)" opacity=".16"><g transform="scale(3)">${hexE(60, { color: false, line: 4 })}</g></g>
    <path d="M-300 ${GROUND_Y - 4} L1580 ${GROUND_Y - 4} L1580 820 L-300 820Z" fill="url(#fh-floor)" stroke="${INK}" stroke-width="5"/>`;
  const desk = `<g>
    <rect x="560" y="500" width="760" height="140" fill="#9a9a9a" stroke="${INK}" stroke-width="7"/>
    <rect x="540" y="486" width="800" height="24" rx="4" fill="#d9d9d9" stroke="${INK}" stroke-width="7"/>
    <g transform="translate(900 575) scale(0.8)">${hexE(46, { color: false, line: 6 })}</g>
    <g transform="translate(700 486)"><rect x="-44" y="-26" width="88" height="26" rx="6" fill="#777" stroke="${INK}" stroke-width="5"/><path d="M-30 -26 L30 -26" stroke="#bbb" stroke-width="4"/></g></g>`;
  const banner = `<g data-t="${id}.bar" style="opacity:0;${bar.css}">
    <rect x="0" y="560" width="1280" height="110" fill="#0b0b0b" opacity=".88"/>
    <rect x="22" y="574" width="1236" height="82" fill="none" stroke="#f2f2f2" stroke-width="3"/>
    <text x="640" y="633" font-size="62" font-weight="900" text-anchor="middle" fill="#f6f6f6" letter-spacing="5" font-family="${SERIF}">${TEXT.matters}</text></g>`;
  return cam.html(`${room}${rex.html}${desk}${pip.html}<g data-t="${id}.bolt" style="opacity:0;${boltT.css}">${bolt(1.0)}</g>${fx}`) + banner;
}
