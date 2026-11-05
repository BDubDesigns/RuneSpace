/**
 * Template scene: one character, one camera, a few effects.
 *
 * Every scene builder has the shape `(ctx) => svgMarkupString`:
 *   - `ctx.cues`  the film-wide cue list; Tracks / characters push into it
 *   - `ctx.at(rel)` scene-relative ms -> absolute film ms (ALWAYS wrap times in at())
 *   - `ctx.id`    unique scene id: prefix every data-t name with it (`${id}.pip`)
 *   - `ctx.dur`   this scene's duration from config.js TIMING
 */
import { prospector } from '../../../art/prospector.js';
import { cutter } from '../../../art/props.js';
import { dust, puff, mark } from '../../../fx/effects.js';
import { Camera } from '../../../kit.js';
import { field, GROUND_Y } from '../world.js';

export function walk(ctx) {
  const { cues, at, id } = ctx;
  const cam = new Camera(cues, id); // wraps the whole shot; pan/zoom with cam.look()
  const pip = prospector(cues, `${id}.pip`, { kind: 'pip', x: -160, y: GROUND_Y, scale: 0.92, pack: true, props: { F: cutter(`${id}.cut`) } });

  pip.walk(at(200), 2200, 520, { stride: 640, amp: 20, bounce: 5, swing: 9 }); // root slides to x=520
  pip.face(at(2600), 'shock'); // instant expression swap (see FACES in art/prospector.js)
  pip.bob.hop(at(2600), 320, 40); // small startled jump, lands where it started
  cam.look(at(2600), 900, { x: 560, y: 430, s: 1.35 }); // slow push-in on the reaction
  pip.face(at(3600), 'smug');

  // Effects take ABSOLUTE start times, hence at().
  const fx =
    dust({ x: 470, y: GROUND_Y + 6, at: at(2500), n: 5, spread: 40, r: 26, dir: -1, seed: 4 }) +
    mark({ x: 560, y: 330, at: at(2600), dur: 1100, size: 100 }) +
    puff({ x: 640, y: 540, at: at(3700), dur: 1400, r: 46, dy: -90, fill: 'url(#g-smoke)' });

  // Anything inside cam.html() moves with the camera; the order is back-to-front.
  return cam.html(`${field()}${pip.html}${fx}`);
}
