/**
 * "FedHex" commercial (issue #491, Stage D): an in-world, silent, 15-second pre-roll.
 * Scene order and transitions live here; durations and text come from config.js.
 */
import { defineFilm } from '../../engine/film.js';
import { filmHelpers } from '../../kit.js';
import { ART, TIMING, CAPTION } from './config.js';
import { WORLD_DEFS } from './world.js';
import { counter } from './scenes/counter.js';
import { boxes } from './scenes/boxes.js';
import { load, fly, arrive } from './scenes/travel.js';
import { unwrap } from './scenes/unwrap.js';
import { ident } from './scenes/ident.js';

const { shot } = filmHelpers({ TIMING, CAPTION });

export default defineFilm({
  id: 'commercial-fedhex',
  title: 'FedHex',
  width: 1280,
  height: 720,
  posterAt: 14400, // the ident, fully revealed
  defs: WORLD_DEFS,
  // The art the host should have decoded before the spot starts.
  assets: [ART.hub.src, ART.logo.src],
  chapters: [
    { id: 'counter', label: 'The counter', scene: 's-counter' },
    { id: 'boxes', label: 'The boxes', scene: 's-boxes' },
    { id: 'delivery', label: 'The delivery', scene: 's-load' },
    { id: 'unwrap', label: 'The unwrapping', scene: 's-unwrap' },
    { id: 'ident', label: 'The ident', scene: 's-ident' },
  ],
  scenes: [shot('counter', counter), shot('boxes', boxes), shot('load', load), shot('fly', fly), shot('arrive', arrive), shot('unwrap', unwrap), shot('ident', ident)],
});
