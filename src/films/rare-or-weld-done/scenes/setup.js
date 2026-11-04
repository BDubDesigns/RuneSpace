/**
 * Beat 1 - The newspaper.
 *   read  : the shabby thief reads the paper in his armchair, then reacts.
 *   paper : close-up of the front page (the headline, the Emerald drawing).
 *   plan  : close-up; the idea; a thought bubble: FENCE dealer, Emerald <-> mountain of Credits.
 *   grab  : he leaps up, grabs his welding gear and runs for it.
 */
import { prospector } from '../../../art/prospector.js';
import { newspaper, bubble, dealer, creditPile } from '../../../art/heist.js';
import { emerald } from '../../../art/emerald.js';
import { torch, gasCart } from '../../../art/weld.js';
import { placed } from '../../../art/props.js';
import { dust, puff, mark, sparkle } from '../../../fx/effects.js';
import { Camera, idle, fwd } from '../../../kit.js';
import { tween, show } from '../../../acting.js';
import { apartment, armchairBack, armchairFront, footstool, GY } from '../world.js';
import { TEXT } from '../config.js';

const SC = 0.95;

export function read(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 640, y: 420, s: 1.5 });
  cam.look(at(0), ctx.dur, { x: 650, y: 440, s: 1.95 }, 'linear');
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 640, y: GY, scale: SC, face: 'normal', armF: -140, armB: -140, legF: -90, legB: -90 });
  const paper = placed(cues, `${id}.paper`, newspaper({ w: 880, h: 1080, back: true }), { x: 650, y: 520, sx: 0.215, sy: 0.215 });

  // --- reading: the paper rustles, he chuckles at the funnies
  paper.track.keys(at(300), 900, [{ o: 0.2, rot: 1.6 }, { o: 0.4, rot: -1.2 }, { o: 0.7, rot: 1.0 }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  thief.bob.keys(at(500), 700, [{ o: 0.25, y: -3 }, { o: 0.5, y: 0 }, { o: 0.75, y: -3 }, { o: 1, y: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  // page turn: flips down and back up
  paper.track.keys(at(1500), 560, [{ o: 0.4, y: 560, rot: -3 }, { o: 1, y: 520, rot: 0 }], { seg: 'ease-in-out', ease: 'linear' });
  thief.face(at(1500), 'glance');
  thief.face(at(1920), 'normal');

  // --- he lowers the paper: shabby, bored, overconfident
  paper.track.to(at(2300), 520, { y: 650, rot: -4 }, { ease: 'ease-in-out' });
  thief.armF.to(at(2300), 520, { rot: -78 }, { ease: 'ease-in-out' });
  thief.armB.to(at(2300), 520, { rot: -70 }, { ease: 'ease-in-out' });
  thief.face(at(2380), 'smug');
  thief.head.to(at(2380), 300, { rot: fwd(thief, -5) });
  idle(thief, at(2300), at(3500), 1000);

  // --- he glances down at the page... and sees it
  thief.face(at(3300), 'glance');
  thief.head.to(at(3300), 260, { rot: fwd(thief, 12) });
  thief.face(at(3900), 'shock');
  thief.head.to(at(3900), 120, { rot: fwd(thief, -4) });
  thief.bob.hop(at(3900), 300, 22);
  paper.track.keys(at(3900), 340, [{ o: 0.4, y: 610, rot: 6 }, { o: 1, y: 640, rot: -2 }], { ease: 'ease-out' });
  thief.armF.to(at(3900), 160, { rot: -30 }, { ease: 'cubic-bezier(.2,1.5,.4,1)' });

  // --- room life: the leaky ceiling drips into a bucket
  cues.push({ at: at(0), dur: 1400, iterations: 3.5, target: `${id}.drip`, easing: 'cubic-bezier(.5,0,1,.6)', keyframes: [{ transform: 'translateY(0px)', opacity: 1 }, { transform: 'translateY(260px)', opacity: 1, offset: 0.9 }, { transform: 'translateY(262px)', opacity: 0 }], reduce: 'skip' });

  const fx = mark({ x: 700, y: 330, at: at(3900), dur: 1100, size: 100 }) + dust({ x: 590, y: GY + 4, at: at(3900), n: 3, spread: 40, r: 18, dir: -1, seed: 5, dur: 600 });
  return cam.html(`${apartment(id)}<g transform="translate(640 ${GY})">${armchairBack()}</g><g transform="translate(790 ${GY})">${footstool()}</g>${thief.html}<g transform="translate(640 ${GY})">${armchairFront()}</g>${paper.html}${fx}`);
}

export function paper(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 640, y: 270, s: 1 });
  // masthead + headline, then the tilt down to the drawing of the Emerald
  cam.look(at(0), 160, { x: 640, y: 290 }, 'linear');
  cam.look(at(3000), 1800, { x: 640, y: 770, s: 1 }, 'ease-in-out');
  const np = placed(cues, `${id}.np`, newspaper({ w: 880, h: 1080, id: `${id}.pg`, lines: { name: TEXT.paperName, head: TEXT.headline, sub: TEXT.headlineSub } }), { x: 640, y: 600, rot: -1.2 });
  np.track.keys(at(0), 5200, [{ o: 0.25, rot: -0.6, x: 644 }, { o: 0.5, rot: -1.6, x: 636 }, { o: 0.75, rot: -0.8, x: 642 }, { o: 1, rot: -1.2, x: 640 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  // the "ONE WEEK ONLY!" banner pulses so it sticks
  cues.push({ at: at(1700), dur: 900, target: `${id}.pg.banner`, easing: 'ease-in-out', keyframes: [{ transform: 'scale(1)' }, { transform: 'scale(1.05)', offset: 0.4 }, { transform: 'scale(1)' }], reduce: 'skip' });
  // his hands hold the sheet
  const hand = (x, y, f) => `<g transform="translate(${x} ${y}) scale(${f} 1)"><path d="M-44 -34 Q-44 -56 -20 -50 L36 -34 Q52 -28 48 -10 L40 28 Q28 52 -8 46 Q-48 38 -44 -34Z" fill="#fff" stroke="#0d0d0d" stroke-width="7" stroke-linejoin="round"/><path d="M-20 -48 L-10 -4 M6 -42 L12 2 M24 -34 L28 8" fill="none" stroke="#999" stroke-width="3.4" stroke-linecap="round"/></g>`;
  const fx =
    sparkle({ x: 590, y: 880, at: at(3600), dur: 900, r: 46, n: 3, s: 1.4 }) +
    sparkle({ x: 700, y: 820, at: at(4000), dur: 800, r: 30, n: 2, s: 1.2 }) +
    sparkle({ x: 660, y: 930, at: at(4300), dur: 800, r: 24, n: 2, s: 1.2 });
  return `<rect x="-400" y="-200" width="2100" height="2000" fill="#777"/>${cam.html(`${np.html}${hand(168, 860, 1)}${hand(1112, 860, -1)}${fx}`)}`;
}

export function plan(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 640, y: 360, s: 1 });
  cam.look(at(0), ctx.dur, { x: 640, y: 360, s: 1.06 }, 'linear');
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 270, y: 830, scale: 2.1, face: 'shock' });
  const B = { x: 840, y: 260, w: 780, h: 500 };
  const bub = bubble(`${id}.b`, B.w, B.h, [[-340, 200, 26], [-394, 250, 17], [-436, 292, 10]]);
  const alley = `<ellipse cx="0" cy="0" rx="352" ry="218" fill="#202020"/><path d="M-352 80 L352 80" stroke="#444" stroke-width="3"/>
    ${[-300, -230, -160].map((x) => `<path d="M${x} -170 L${x + 8} 70" stroke="#333" stroke-width="3"/>`).join('')}
    <circle cx="150" cy="-110" r="70" fill="url(#g-glow)" opacity=".35"/>`;
  const dealerP = placed(cues, `${id}.d`, `<g transform="scale(1.32)">${dealer(`${id}.dl`, TEXT.fence)}</g>`, { x: 20, y: 204, sx: 0, sy: 0 });
  const gemP = placed(cues, `${id}.gem`, `<g transform="scale(.4)">${emerald(`${id}.em`, { w: 300, h: 360 })}</g>`, { x: -270, y: 206, sx: 0, sy: 0 });
  const pileP = placed(cues, `${id}.pile`, `<g transform="scale(1)">${creditPile(9, 420, 230)}</g>`, { x: 190, y: 214, sx: 0, sy: 0 });
  const bubP = placed(cues, `${id}.bub`, `${bub}<g data-t="${id}.scene">${alley}${dealerP.html}${gemP.html}${pileP.html}</g>`, { x: B.x, y: B.y });

  // --- the idea: thief stares at the page, then his eyes go distant
  thief.face(at(0), 'shock');
  thief.face(at(700), 'glance');
  thief.head.to(at(700), 300, { rot: fwd(thief, -7) });
  thief.bob.keys(at(700), 600, [{ o: 0.5, sy: 1.01 }, { o: 1, sy: 1 }], { ease: 'ease-in-out', reduce: 'skip' });
  thief.face(at(1200), 'plot'); // a thought is forming
  // --- bubble: three tail dots, then the cloud pops
  [0, 1, 2].forEach((i) => {
    cues.push({ at: at(1250 + i * 230), dur: 220, target: `${id}.b.t${i}`, easing: 'cubic-bezier(.2,1.6,.4,1)', keyframes: [{ transform: 'scale(0)' }, { transform: 'scale(1)' }] });
    // tails scale about their own centres
  });
  cues.push({ at: at(1950), dur: 420, target: `${id}.b.cloud`, easing: 'cubic-bezier(.2,1.4,.4,1)', keyframes: [{ transform: 'scale(0.05)' }, { transform: 'scale(1)' }] });
  // contents appear with the cloud: dealer first
  tween(cues, `${id}.scene`, at(1900), 1, { opacity: 0 }, { opacity: 1 });
  dealerP.track.keys(at(2250), 420, [{ o: 0.6, sx: 1.12, sy: 1.12 }, { o: 1, sx: 1, sy: 1 }], { ease: 'ease-out' });
  // the dealer: shifty eyes, smoke
  cues.push({ at: at(2700), dur: 400, iterations: 3, target: `${id}.dl.eyes`, easing: 'steps(1,end)', keyframes: [{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }], direction: 'alternate', reduce: 'skip' });
  // 'here comes the Emerald': it slides in from the left, the dealer's hand comes out
  gemP.track.keys(at(3300), 460, [{ o: 0.6, sx: 1.1, sy: 1.1 }, { o: 1, sx: 1, sy: 1 }], { ease: 'ease-out' });
  gemP.track.to(at(3900), 500, { x: -110 }, { ease: 'ease-in-out' });
  cues.push({ at: at(3900), dur: 500, target: `${id}.dl.arm`, easing: 'ease-in-out', keyframes: [{ transform: 'translate(44px, -122px) rotate(0deg)' }, { transform: 'translate(44px, -122px) rotate(-18deg)' }] });
  // the trade: the gem vanishes into his coat, the mountain of Credits grows
  gemP.track.keys(at(4500), 260, [{ o: 1, sx: 0, sy: 0, x: -40 }], { ease: 'ease-in' });
  pileP.track.keys(at(4500), 760, [{ o: 0.55, sx: 1.25, sy: 1.25 }, { o: 1, sx: 1, sy: 1 }], { ease: 'ease-out' });
  pileP.track.keys(at(5400), 500, [{ o: 0.5, sx: 1.2, sy: 1.16 }, { o: 1, sx: 1.12, sy: 1.1 }], { ease: 'ease-in-out' });
  dealerP.track.to(at(4500), 300, { x: -4 }, { ease: 'ease-out' });
  // --- the thief grins
  thief.face(at(4600), 'greed');
  thief.bob.hop(at(4600), 300, 26);
  thief.head.keys(at(4900), 900, [{ o: 0.3, rot: fwd(thief, 4) }, { o: 0.6, rot: fwd(thief, -3) }, { o: 1, rot: 0 }], { seg: 'ease-in-out', ease: 'linear', reduce: 'skip' });
  thief.vibrate(at(5200), 2200, 3);
  // bubble pops away at the end (he has made up his mind)
  cues.push({ at: at(7500), dur: 380, target: `${id}.bub`, easing: 'ease-in', keyframes: [{ opacity: 1 }, { opacity: 0 }], reduce: 'snap' });
  thief.face(at(6500), 'plot');
  thief.bob.keys(at(6500), 500, [{ o: 0.5, sy: 1.02, sx: 0.99 }, { o: 1, sy: 1, sx: 1 }], { ease: 'ease-in-out', reduce: 'skip' });

  const fx =
    puff({ x: 460, y: 400, at: at(1250), dur: 600, r: 24, dy: -20, opacity: 0.6 }) +
    puff({ x: 905, y: 150, at: at(2700), dur: 1300, r: 22, dy: -50, dx: 24, opacity: 0.6, fill: 'url(#g-dust)' }) +
    sparkle({ x: 900, y: 250, at: at(4700), dur: 900, r: 24, n: 3, s: 1.2 }) +
    sparkle({ x: 1060, y: 190, at: at(5000), dur: 900, r: 20, n: 3, s: 1.2 }) +
    sparkle({ x: 980, y: 380, at: at(5300), dur: 900, r: 22, n: 2, s: 1.2 });
  return `<rect width="1280" height="720" fill="#d0d0d0"/>${cam.html(`${thief.html}${bubP.html}${fx}`)}`;
}

export function grab(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id, { x: 640, y: 400, s: 1.02 });
  cam.look(at(500), 1400, { x: 800, y: 410, s: 1.12 }, 'ease-in-out');
  const thief = prospector(cues, `${id}.thief`, { kind: 'thief', x: 640, y: GY, scale: SC, face: 'plot', armF: -30, armB: -30, legF: -90, legB: -90, props: { F: torch(`${id}.tc`) } });
  const rack = placed(cues, `${id}.rack`, `<g transform="scale(.9)">${torch(`${id}.rt`)}</g>`, { x: 1040, y: 380, rot: 20 });
  const cart = gasCart(`${id}.gc`);
  const cartP = placed(cues, `${id}.cart`, cart, { x: 1120, y: GY });
  const goggP = placed(cues, `${id}.gg`, `<circle cx="-16" r="14" fill="#2b2b2b" stroke="#0d0d0d" stroke-width="5"/><circle cx="14" r="14" fill="#2b2b2b" stroke="#0d0d0d" stroke-width="5"/><path d="M-30 0 Q0 -10 30 0" fill="none" stroke="#0d0d0d" stroke-width="5"/>`, { x: 1000, y: 340 });
  // leap out of the chair (the legs come down), then run to the rack
  thief.bob.keys(at(300), 360, [{ o: 0.4, y: -70, sy: 1.04 }, { o: 1, y: 0 }], { ease: 'ease-out' });
  thief.legF.to(at(300), 260, { rot: 0 }, { ease: 'ease-out' });
  thief.legB.to(at(300), 260, { rot: 0 }, { ease: 'ease-out' });
  thief.armF.to(at(300), 260, { rot: -150 }, { ease: 'ease-out' });
  thief.armB.to(at(300), 260, { rot: -150 }, { ease: 'ease-out' });
  thief.root.to(at(300), 360, { x: 700 }, { ease: 'ease-out' });
  thief.walk(at(700), 1050, 950, { stride: 240, amp: 40, bounce: 8, swing: 24 });
  // snatches the torch, pulls the goggles on, grins to camera
  show(cues, `${id}.rack`, at(1800), false);
  show(cues, `${id}.thief.propF`, at(1800), true);
  thief.armF.to(at(1750), 160, { rot: -80 }, { ease: 'ease-out' });
  thief.propF.to(at(1850), 160, { rot: -20 });
  show(cues, `${id}.gg`, at(2000), false);
  thief.goggles(at(2000), 'up');
  thief.face(at(1900), 'smug');
  thief.armF.to(at(2150), 300, { rot: -120 }, { ease: 'ease-in-out' });
  thief.bob.keys(at(2100), 300, [{ o: 0.5, sy: 0.93, sx: 1.05 }, { o: 1, sy: 1, sx: 1 }], { ease: 'ease-out', reduce: 'skip' });
  const fx = dust({ x: 760, y: GY + 4, at: at(700), n: 4, spread: 50, r: 20, dir: -1, seed: 6, dur: 600 }) + sparkle({ x: 1050, y: 360, at: at(1800), dur: 700, r: 22, n: 2 });
  return cam.html(`${apartment(id)}<g transform="translate(640 ${GY})">${armchairBack()}</g><g transform="translate(790 ${GY})">${footstool()}</g>${rack.html}${goggP.html}${cartP.html}${thief.html}<g transform="translate(640 ${GY})">${armchairFront()}</g>${fx}`);
}
