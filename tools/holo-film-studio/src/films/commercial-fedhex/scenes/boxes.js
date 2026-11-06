/**
 * 3-7 s. The bolt is boxed; that box goes inside a bigger box; those go inside a huge crate. Each
 * gets an official stamp, with thunderous assembly-line seriousness. The camera pulls back as the
 * packaging grows, and the crate finally rides away.
 */
import { Track, tween } from '../../../acting.js';
import { Camera } from '../../../kit.js';
import { speedLines } from '../../../fx/effects.js';
import { INK } from '../../../art/props.js';
import { BELT_Y, bolt, hexE, parcel, stamper } from '../world.js';

export function boxes(ctx) {
  const { cues, at, id, dur } = ctx;
  const cam = new Camera(cues, id, { x: 640, y: 480, s: 2.3 });
  const X = 640;

  const mark = (name, w, h, hit) => {
    tween(cues, `${id}.${name}.mark`, at(hit), 60, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
    return `<g data-t="${id}.${name}.mark" style="opacity:0" transform="translate(0 ${-h * 0.5}) scale(${w / 130})">${hexE(46, { color: false, line: 6 })}</g>`;
  };
  const stamp = (name, y, scale, hitAt) => {
    const t = new Track(cues, `${id}.${name}.arm`, { x: X, y: y - 190 * scale });
    t.to(at(hitAt - 150), 150, { y }, { ease: 'ease-in', reduce: 'snap' });
    t.to(at(hitAt), 220, { y: y - 190 * scale }, { ease: 'ease-out', reduce: 'snap' });
    return `<g data-t="${id}.${name}.arm" style="${t.css}">${stamper(scale)}</g>`;
  };

  // --- the small box and the bolt
  const box1 = new Track(cues, `${id}.box1`, { x: -150, y: BELT_Y });
  box1.to(at(0), 520, { x: X }, { ease: 'ease-out', reduce: 'snap' });
  tween(cues, `${id}.box1`, at(1560), 40, { opacity: 1 }, { opacity: 0 }, { reduce: 'snap' });
  const lid = new Track(cues, `${id}.lid`, { x: -45, y: -80, rot: -112 });
  lid.to(at(800), 220, { rot: 0 }, { ease: 'ease-in', reduce: 'snap' });
  const boltT = new Track(cues, `${id}.bolt`, { x: X, y: BELT_Y - 270, sx: 1.2, sy: 1.2 });
  tween(cues, `${id}.bolt`, at(480), 100, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
  boltT.to(at(600), 220, { y: BELT_Y - 40 }, { ease: 'ease-in', reduce: 'snap' });
  tween(cues, `${id}.bolt`, at(820), 40, { opacity: 1 }, { opacity: 0 }, { reduce: 'snap' });

  // --- the bigger box, dropped over it, and the huge crate over that
  const box2 = new Track(cues, `${id}.box2`, { x: X, y: -420 });
  box2.to(at(1350), 210, { y: BELT_Y }, { ease: 'ease-in', reduce: 'snap' });
  tween(cues, `${id}.box2`, at(0), 1, { opacity: 0 }, { opacity: 0 }, { reduce: 'snap' });
  tween(cues, `${id}.box2`, at(1340), 1, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
  tween(cues, `${id}.box2`, at(2350), 40, { opacity: 1 }, { opacity: 0 }, { reduce: 'snap' });
  const crate = new Track(cues, `${id}.crate`, { x: X, y: -560 });
  crate.to(at(2100), 250, { y: BELT_Y }, { ease: 'ease-in', reduce: 'snap' });
  crate.to(at(3000), 1000, { x: 1700 }, { ease: 'ease-in', reduce: 'snap' });
  tween(cues, `${id}.crate`, at(2090), 1, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });

  // --- the camera pulls back as the packaging grows
  cam.shake(at(1000), 200, 9);
  cam.look(at(1200), 400, { x: 640, y: 450, s: 1.5 });
  cam.shake(at(1700), 200, 9);
  cam.look(at(1900), 400, { x: 640, y: 420, s: 1.05 });
  cam.shake(at(2500), 300, 16);
  cam.look(at(2800), 500, { x: 640, y: 400, s: 0.82 });

  // The belt scrolls.
  const stripes = Array.from({ length: 30 }, (_, i) => `<path d="M${-300 + i * 80} ${BELT_Y + 4} L${-300 + i * 80 + 28} ${BELT_Y + 62}" stroke="#555" stroke-width="10"/>`).join('');
  cues.push({ at: at(0), dur: 400, iterations: Math.floor(dur / 400), target: `${id}.belt`, keyframes: [{ transform: 'translateX(0px)' }, { transform: 'translateX(-80px)' }], easing: 'linear', reduce: 'skip' });

  const world = `<rect x="-600" y="-300" width="2600" height="1100" fill="url(#fh-wall)"/>
    <rect x="-600" y="${BELT_Y}" width="2600" height="400" fill="#7a7a7a" stroke="${INK}" stroke-width="6"/>
    <g data-t="${id}.belt" style="transform:translateX(0px)">${stripes}</g>
    <rect x="-600" y="${BELT_Y - 8}" width="2600" height="16" fill="#3a3a3a" stroke="${INK}" stroke-width="4"/>`;

  const b1 = `<g data-t="${id}.box1" style="${box1.css}">${parcel(100, 84)}<g data-t="${id}.lid" style="${lid.css}"><rect x="0" y="-8" width="90" height="12" rx="3" fill="#e8e8e8" stroke="${INK}" stroke-width="4"/></g>${mark('b1', 84, 84, 1000)}</g>`;
  const b2 = `<g data-t="${id}.box2" style="opacity:0;${box2.css}">${parcel(210, 180)}${mark('b2', 150, 180, 1700)}</g>`;
  const cr = `<g data-t="${id}.crate" style="opacity:0;${crate.css}">${parcel(400, 310, { slats: true })}${mark('c', 250, 310, 2500)}</g>`;
  const fx = `<g transform="translate(${1400} ${BELT_Y - 130})">${speedLines({ x: 0, y: 0, at: at(3000), dur: 300, total: 1000, n: 6, len: 220, dir: 1, spreadY: 120, seed: 4 })}</g>`;
  const bt = `<g data-t="${id}.bolt" style="opacity:0;${boltT.css}">${bolt(1)}</g>`;
  return cam.html(`${world}${b1}${b2}${cr}${bt}${stamp('s1', BELT_Y - 84, 0.8, 1000)}${stamp('s2', BELT_Y - 180, 1.2, 1700)}${stamp('s3', BELT_Y - 310, 2.0, 2500)}${fx}`);
}
