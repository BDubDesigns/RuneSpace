/**
 * 10-12.4 s. Worker 2 gives up explaining, takes Worker 1 by the head and turns it toward the
 * brightly lit DeWhat? Emergency Power Annex sign in the window.
 */
import { prospector } from '../../../art/prospector.js';
import { tween } from '../../../acting.js';
import { flash, rays, sparkle, mark } from '../../../fx/effects.js';
import { Camera } from '../../../kit.js';
import { INK } from '../../../art/props.js';
import { TEXT } from '../config.js';
import { workshop, annexSign, GROUND_Y } from '../world.js';

export function sign(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const rex = prospector(cues, `${id}.rex`, { kind: 'rex', x: 190, y: GROUND_Y, scale: 1.6, face: 'angry' });
  const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: 430, y: GROUND_Y, scale: 1.6, flip: -1, face: 'shock' });

  // Rex plants a hand on Pip's head and wrenches it around toward the window.
  rex.yap(at(80), 500);
  rex.armF.to(at(120), 380, { rot: -118 }, { ease: 'ease-out', reduce: 'snap' });
  pip.head.to(at(520), 260, { rot: -24 }, { ease: 'ease-in', reduce: 'snap' });
  pip.root.set(at(800), { flip: 1 });
  pip.bob.keys(at(800), 360, [{ o: 0.4, sx: 1.08, sy: 0.9 }, { o: 1, sx: 1, sy: 1 }], { ease: 'ease-out', reduce: 'skip' });
  pip.head.to(at(800), 300, { rot: 0 }, { ease: 'ease-out', reduce: 'snap' });
  pip.face(at(900), 'greed');
  rex.face(at(1100), 'smug');
  rex.armF.to(at(1000), 420, { rot: 0 }, { ease: 'ease-in-out', reduce: 'snap' });
  rex.fold(at(1500));

  // The sign lights up in the window: a flash, the board, the glow, the bulbs.
  const board = `${id}.sign`;
  tween(cues, `${board}.board`, at(850), 60, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
  tween(cues, `${board}.glow`, at(850), 200, { opacity: 0 }, { opacity: 1 }, { reduce: 'snap' });
  const fx =
    flash({ at: at(850), dur: 260, peak: 0.85 }) +
    rays({ x: 960, y: 270, at: at(870), n: 14, r0: 190, r1: 320, dur: 520, stroke: '#fff', width: 7, late: true }) +
    sparkle({ x: 760, y: 150, at: at(900), dur: 700, r: 26 }) +
    sparkle({ x: 1170, y: 392, at: at(1000), dur: 700, r: 26 }) +
    mark({ x: 430, y: 300, at: at(1000), text: '!', dur: 1200, size: 110 });

  const window = `<g transform="translate(960 270)">
    <rect x="-300" y="-190" width="600" height="380" fill="url(#dw-night)"/>
    <g transform="scale(0.9)">${annexSign(board)}</g>
    <rect x="-300" y="-190" width="600" height="380" fill="none" stroke="${INK}" stroke-width="16"/>
    <rect x="-312" y="-202" width="624" height="404" fill="none" stroke="#9a9a9a" stroke-width="8"/>
  </g>`;
  void TEXT;
  return cam.html(
    `${workshop()}${rex.html}${pip.html}<rect x="-300" y="-100" width="1880" height="900" fill="#000" opacity="0.5"/>${window}${fx}`
  );
}
