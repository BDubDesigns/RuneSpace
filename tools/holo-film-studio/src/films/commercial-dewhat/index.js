/**
 * "DeWHAT" commercial (issue #491, Stage D): an in-world, silent, 15-second pre-roll.
 * Scene order and transitions live here; durations and text come from config.js.
 */
import { defineFilm } from '../../engine/film.js';
import { filmHelpers } from '../../kit.js';
import { TIMING, CAPTION } from './config.js';
import { WORLD_DEFS } from './world.js';
import { dark } from './scenes/dark.js';
import { talk } from './scenes/talk.js';
import { sign } from './scenes/sign.js';
import { card } from './scenes/card.js';

const { shot } = filmHelpers({ TIMING, CAPTION });

export default defineFilm({
  id: 'commercial-dewhat',
  title: 'DeWHAT',
  width: 1280,
  height: 720,
  posterAt: 14200, // the company card, fully revealed
  defs: WORLD_DEFS,
  chapters: [
    { id: 'power', label: "Power's out", scene: 's-dark' },
    { id: 'argument', label: 'The argument', scene: 's-talk' },
    { id: 'sign', label: 'The sign', scene: 's-sign' },
    { id: 'card', label: 'The slogan', scene: 's-card' },
  ],
  scenes: [shot('dark', dark), shot('talk', talk), shot('sign', sign), shot('card', card)],
});
