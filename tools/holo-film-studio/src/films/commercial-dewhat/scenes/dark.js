/**
 * 0-3 s. The lights go out, an alarm flashes, and Worker 1 (Pip) panics. Worker 2 (Rex) does not.
 */
import { prospector } from '../../../art/prospector.js';
import { tween } from '../../../acting.js';
import { Camera, idle } from '../../../kit.js';
import { TEXT } from '../config.js';
import { workshop, speech, GROUND_Y } from '../world.js';

export function dark(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: 300, y: GROUND_Y, scale: 1.6, face: 'normal' });
  const rex = prospector(cues, `${id}.rex`, { kind: 'rex', x: 980, y: GROUND_Y, scale: 1.6, flip: -1, face: 'normal' });
  idle(rex, at(0), at(1400), 700);

  // The lights cut out (a flicker first), then the alarm pulses.
  const darkId = `${id}.dark`;
  tween(cues, darkId, at(600), 50, { opacity: 0 }, { opacity: 0.5 }, { reduce: 'snap' });
  tween(cues, darkId, at(650), 60, { opacity: 0.5 }, { opacity: 0.1 }, { reduce: 'snap' });
  tween(cues, darkId, at(710), 50, { opacity: 0.1 }, { opacity: 0.5 }, { reduce: 'snap' });
  [1100, 1700, 2300, 2800].forEach((t, i) => {
    const a = `${id}.alarm${i}`;
    cues.push({ at: at(t), dur: 140, target: a, keyframes: [{ opacity: 0 }, { opacity: 0.22 }, { opacity: 0 }], easing: 'linear', reduce: 'skip' });
  });

  // Worker 1 realises, hops, and shouts.
  pip.face(at(760), 'shock');
  pip.bob.hop(at(760), 360, 34);
  pip.face(at(1050), 'angry');
  pip.yap(at(1100), 1500);
  pip.head.keys(at(1100), 1500, [{ o: 0.2, rot: -5 }, { o: 0.4, rot: 5 }, { o: 0.6, rot: -5 }, { o: 0.8, rot: 5 }, { o: 1, rot: 0 }], { ease: 'linear', reduce: 'skip' });
  rex.face(at(900), 'glance');
  rex.fold(at(1500));
  rex.face(at(1900), 'smug');

  const line = speech(cues, `${id}.say`, TEXT.opening, { x: 425, bottom: 262, tailX: -110, size: 58 });
  line.appear(at(1060)).shout(at(1340), 700);

  const alarms = [0, 1, 2, 3].map((i) => `<rect data-t="${id}.alarm${i}" width="1280" height="720" fill="#fff" style="opacity:0"/>`).join('');
  return cam.html(`${workshop()}${rex.html}${pip.html}<rect data-t="${darkId}" x="-300" y="-100" width="1880" height="900" fill="#000" style="opacity:0"/>${alarms}${line.html}`);
}
