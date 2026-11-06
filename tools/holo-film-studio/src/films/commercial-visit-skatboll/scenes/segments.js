/**
 * The four segments of the tourism advertisement. Each is real approved 4:1 art, panned.
 */
import { sparks, sparkle, rng } from '../../../fx/effects.js';
import { Track, tween } from '../../../acting.js';
import { INK } from '../../../art/props.js';
import { ART, TEXT } from '../config.js';
import { panorama, banner, postcardFrame, FRAME } from '../world.js';

const reach = (art, zoom = 1) => FRAME.w - art.w * (FRAME.h / art.h) * zoom; // the leftmost the picture can slide

/** DAZZLING NIGHTLIFE! Pan across the lit workshops while welding sparks fly. */
export function nightlife(ctx) {
  const { cues, at, id, dur } = ctx;
  const art = ART.nightlife;
  const end = reach(art);
  // Sparks live on the picture, at the workbench, so they travel with the pan.
  let fx = '';
  for (let i = 0; i < 8; i++) {
    fx += sparks({ x: 1330 + (i % 3) * 70, y: 500, at: at(250 + i * 440), n: 22, power: 260, dur: 640, seed: 3 + i, size: 2.6 });
  }
  const pan = panorama(cues, `${id}.pan`, art, { at: at(0), dur, fromX: -80, toX: end + 60, fx });
  const title = banner(cues, `${id}.title`, TEXT.nightlife, { y: 560 });
  title.popIn(at(300));
  const glints = sparkle({ x: 250, y: 170, at: at(500), dur: 900, r: 30, n: 3 }) + sparkle({ x: 1080, y: 250, at: at(1300), dur: 900, r: 26, n: 3 });
  return `${pan.html}${glints}${title.html}${postcardFrame()}`;
}

/** BREATHTAKING SCENERY! Pan, the other way, across the mountains and mining works. */
export function scenery(ctx) {
  const { cues, at, id, dur } = ctx;
  const art = ART.scenery;
  const pan = panorama(cues, `${id}.pan`, art, { at: at(0), dur, fromX: reach(art) + 40, toX: -40 });
  const title = banner(cues, `${id}.title`, TEXT.scenery, { y: 565, rot: 2 });
  title.popIn(at(300));
  const glints = sparkle({ x: 190, y: 190, at: at(500), dur: 900, r: 32, n: 3 }) + sparkle({ x: 1100, y: 130, at: at(1500), dur: 900, r: 28, n: 3 });
  return `${pan.html}${glints}${title.html}${postcardFrame()}`;
}

/** UNFORGETTABLE HOSPITALITY! Pan across the warm front of HH B&B. */
export function hospitality(ctx) {
  const { cues, at, id, dur } = ctx;
  const art = ART.hospitality;
  const pan = panorama(cues, `${id}.pan`, art, { at: at(0), dur, fromX: -60, toX: reach(art) + 60 });
  const title = banner(cues, `${id}.title`, TEXT.hospitality, { y: 545, rot: -2 });
  title.popIn(at(300));
  const glints = sparkle({ x: 210, y: 210, at: at(600), dur: 900, r: 30, n: 3 }) + sparkle({ x: 1060, y: 170, at: at(1400), dur: 900, r: 30, n: 3 });
  return `${pan.html}${glints}${title.html}${postcardFrame()}`;
}

/** SKATBOLL, IT'S NOT ALL WORK. ...and a small stamp: MOSTLY WORK. */
export function finale(ctx) {
  const { cues, at, id, dur } = ctx;
  const art = ART.finale;
  const pan = panorama(cues, `${id}.pan`, art, { at: at(0), dur, fromX: reach(art) * 0.5 - 220, toX: reach(art) * 0.5 + 120 });
  const title = banner(cues, `${id}.title`, TEXT.finale, { y: 470, size: 150, rot: -2 });
  title.popIn(at(200));
  // The rubber stamp lands late and small, and that is the joke.
  const stamp = new Track(cues, `${id}.stamp`, { x: 960, y: 640, sx: 2.2, sy: 2.2, rot: 8 });
  tween(cues, `${id}.stamp`, at(1650), 80, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
  stamp.keys(at(1650), 260, [{ o: 0.7, sx: 0.92, sy: 0.92, ease: 'ease-in' }, { o: 1, sx: 1, sy: 1 }], { ease: 'linear', reduce: 'snap' });
  const stampHtml = `<g data-t="${id}.stamp" style="opacity:0;${stamp.css}">
    <rect x="-236" y="-40" width="472" height="80" rx="8" fill="#fff" stroke="${INK}" stroke-width="7"/>
    <rect x="-224" y="-30" width="448" height="60" rx="4" fill="none" stroke="#b3261e" stroke-width="3"/>
    <text y="17" font-size="46" font-weight="900" text-anchor="middle" fill="#b3261e" font-family="'Arial Black','Trebuchet MS',Impact,'DejaVu Sans',sans-serif" letter-spacing="2">${TEXT.stamp}</text>
  </g>`;
  const glints = sparkle({ x: 220, y: 200, at: at(400), dur: 900, r: 30, n: 3 }) + sparkle({ x: 1090, y: 150, at: at(900), dur: 900, r: 28, n: 3 });
  void rng;
  void dur;
  return `${pan.html}${glints}${title.html}${stampHtml}${postcardFrame()}`;
}
