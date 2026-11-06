/**
 * 3-10 s. The misunderstanding: six lines, each louder than the last, the two workers' balloons
 * overlapping as they talk over each other.
 */
import { prospector } from '../../../art/prospector.js';
import { Camera } from '../../../kit.js';
import { TEXT } from '../config.js';
import { workshop, speech, GROUND_Y } from '../world.js';

// When each of the six lines is spoken (scene-relative ms), and its lettering size.
const WHEN = [0, 1050, 2250, 3350, 4400, 5500];
const SIZE = [54, 46, 56, 58, 70, 56];

export function talk(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id);
  const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: 300, y: GROUND_Y, scale: 1.6, face: 'angry' });
  const rex = prospector(cues, `${id}.rex`, { kind: 'rex', x: 980, y: GROUND_Y, scale: 1.6, flip: -1, face: 'smug' });
  rex.fold(at(0));

  // Persistent darkness with the alarm still pulsing.
  const alarms = [];
  for (let i = 0; i < 9; i++) {
    const a = `${id}.alarm${i}`;
    cues.push({ at: at(250 + i * 760), dur: 140, target: a, keyframes: [{ opacity: 0 }, { opacity: 0.2 }, { opacity: 0 }], easing: 'linear', reduce: 'skip' });
    alarms.push(`<rect data-t="${a}" width="1280" height="720" fill="#fff" style="opacity:0"/>`);
  }

  const balloons = TEXT.lines.map((l, i) => {
    const pipSide = l.who === 1;
    return speech(cues, `${id}.b${i}`, l.lines, {
      x: pipSide ? 400 : 950,
      bottom: pipSide ? 266 : 196,
      tailX: pipSide ? -90 : 20,
      size: SIZE[i],
      tilt: pipSide ? -2 : 2,
    });
  });
  const lastOnSide = { 1: null, 2: null };
  TEXT.lines.forEach((l, i) => {
    const t = at(WHEN[i]);
    const b = balloons[i];
    b.appear(t).shout(t + 280, i >= 4 ? 800 : 600, i >= 4 ? 1.18 : 1.12);
    // The balloon it replaces on its side clears as the new one pops in.
    if (lastOnSide[l.who]) lastOnSide[l.who].vanish(t);
    lastOnSide[l.who] = b;
    const who = l.who === 1 ? pip : rex;
    const next = WHEN[i + 1] ?? 7000;
    const dur = Math.max(500, Math.min(next - WHEN[i], 1200) - 100);
    if (l.who === 2 && i >= 2) who.face(t, 'angry');
    if (l.who === 1 || i >= 2) who.yap(t + 120, dur);
  });
  // Worker 2 loses his patience, Worker 1 loses his mind: both rattle harder each time.
  pip.shake(at(1100), 700, 4);
  rex.shake(at(2300), 700, 5);
  pip.shake(at(3400), 800, 6);
  rex.shake(at(4450), 900, 8);
  pip.shake(at(5550), 1200, 8);
  cam.shake(at(4450), 900, 7);
  cam.shake(at(5550), 1300, 10);

  return cam.html(
    `${workshop()}${rex.html}${pip.html}<rect x="-300" y="-100" width="1880" height="900" fill="#000" opacity="0.45"/>${alarms.join('')}${balloons.map((b) => b.html).join('')}`
  );
}

