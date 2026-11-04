/**
 * Template film. Registered (hidden from the demo nav) as 'template' in src/films/index.js so it
 * is built by the automated tests and can be opened with ?film=template while developing.
 *
 * Copy this folder, rename, then replace world / scenes / text. Keep this file's shape:
 * scene order, transitions and chapter markers live here; durations and text in config.js.
 */
import { defineFilm } from '../../engine/film.js';
import { filmHelpers } from '../../kit.js';
import { TEXT, TIMING, CAPTION } from './config.js';
import { WORLD_DEFS } from './world.js';
import * as walk from './scenes/walk.js';

const { titleCard, shot } = filmHelpers({ TIMING, CAPTION });

export default defineFilm({
  id: 'template',
  title: 'Template Film',
  width: 1280,
  height: 720,
  posterAt: 3000, // idle poster frame, in ms: pick a moment where the title card is fully revealed
  defs: WORLD_DEFS,

  // Jump points shown in the demo page (and available as player.chapters): scene ids, in order.
  chapters: [
    { id: 'intro', label: 'Opening', scene: 'c-title' },
    { id: 'beat1', label: '1 · The walk', scene: 's-walk' },
  ],

  scenes: [
    titleCard('title', [{ t: TEXT.title[0], size: 128, spacing: 6 }, { t: TEXT.title[1], size: 150, spacing: 8 }], { kind: 'title', sub: TEXT.subtitle, dy: -34 }),
    titleCard('gag', TEXT.gag),
    shot('walk', walk.walk, { in: 'iris', irisIn: [30, 60] }),
    titleCard('end', TEXT.end, { kind: 'end', size: 120 }, { inMs: 700, outMs: 0, out: 'cut' }),
  ],
});
