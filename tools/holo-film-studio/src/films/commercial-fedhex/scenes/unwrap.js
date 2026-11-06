/**
 * 11-13 s. The recipient opens the crate and rapidly unwraps the nested boxes to find the single
 * bolt, safely intact.
 */
import { prospector } from '../../../art/prospector.js';
import { Track, tween } from '../../../acting.js';
import { sparkle, puff, rays } from '../../../fx/effects.js';
import { Camera } from '../../../kit.js';
import { INK } from '../../../art/props.js';
import { GROUND_Y, bolt, parcel } from '../world.js';

export function unwrap(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const who = prospector(cues, `${id}.who`, { kind: 'thief', x: 300, y: GROUND_Y, scale: 1.6, face: 'normal' });
  const X = 820;
  const TABLE = 520;

  // Each layer pops open and away in turn, faster as the boxes shrink.
  const layers = [
    { name: 'crate', w: 380, h: 300, slats: true, t: 260, rot: 14 },
    { name: 'box2', w: 200, h: 170, t: 700, rot: -12 },
    { name: 'box1', w: 100, h: 84, t: 1020, rot: 10 },
  ];
  const fx = [];
  const html = layers
    .map((l) => {
      const tr = new Track(cues, `${id}.${l.name}`, { x: X, y: TABLE });
      tr.to(at(l.t), 280, { y: TABLE - 70, sx: 1.35, sy: 1.35, rot: l.rot }, { ease: 'ease-out', reduce: 'snap' });
      tween(cues, `${id}.${l.name}`, at(l.t), 280, { opacity: 1 }, { opacity: 0 }, { reduce: 'snap' });
      fx.push(puff({ x: X, y: TABLE - l.h * 0.5, at: at(l.t), dur: 500, r: l.w * 0.4, dy: -30 }));
      return { l, tr };
    })
    .reverse()
    .map(({ l, tr }) => `<g data-t="${id}.${l.name}" style="${tr.css}">${parcel(l.w, l.h, { slats: l.slats })}</g>`)
    .join('');
  // (reversed so the crate, the outermost layer, is drawn last, on top)
  const stack = layers.length ? html : '';
  const boltT = new Track(cues, `${id}.bolt`, { x: X, y: TABLE - 30 });
  boltT.to(at(1300), 260, { y: TABLE - 150, sx: 1.5, sy: 1.5 }, { ease: 'ease-out', reduce: 'snap' });

  // The recipient: a flurry of unwrapping arms, then a delighted cheer.
  who.armF.keys(at(150), 1000, [
    { o: 0.15, rot: -60 }, { o: 0.3, rot: -10 }, { o: 0.45, rot: -60 }, { o: 0.6, rot: -10 }, { o: 0.8, rot: -60 }, { o: 1, rot: -10 },
  ], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  who.armB.keys(at(250), 900, [{ o: 0.2, rot: -50 }, { o: 0.4, rot: 0 }, { o: 0.6, rot: -50 }, { o: 0.8, rot: 0 }, { o: 1, rot: -50 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  who.face(at(1300), 'cheer');
  who.armF.to(at(1250), 300, { rot: -160 }, { ease: 'ease-out', reduce: 'snap' });
  who.armB.to(at(1250), 300, { rot: -155 }, { ease: 'ease-out', reduce: 'snap' });
  who.bob.hop(at(1350), 360, 40, {}, { reduce: 'skip' });

  const glow = sparkle({ x: X + 10, y: TABLE - 190, at: at(1380), dur: 600, r: 40, n: 3 }) + rays({ x: X, y: TABLE - 150, at: at(1330), n: 12, r0: 50, r1: 120, dur: 520, stroke: INK, width: 6, late: true });
  const room = `<rect x="-300" y="-100" width="1880" height="760" fill="url(#fh-wall)"/>
    <path d="M-300 ${GROUND_Y - 4} L1580 ${GROUND_Y - 4} L1580 820 L-300 820Z" fill="url(#fh-floor)" stroke="${INK}" stroke-width="5"/>
    <g><rect x="560" y="${TABLE}" width="520" height="30" rx="5" fill="#d9d9d9" stroke="${INK}" stroke-width="7"/><rect x="590" y="${TABLE + 30}" width="26" height="${GROUND_Y - TABLE - 30}" fill="#8d8d8d" stroke="${INK}" stroke-width="5"/><rect x="1024" y="${TABLE + 30}" width="26" height="${GROUND_Y - TABLE - 30}" fill="#8d8d8d" stroke="${INK}" stroke-width="5"/></g>`;
  return cam.html(`${room}${who.html}<g data-t="${id}.bolt" style="${boltT.css}">${bolt(1)}</g>${stack}${fx.join('')}${glow}`);
}
