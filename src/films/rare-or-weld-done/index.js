/**
 * "Rare or Weld Done?" - film definition.
 *
 * Scene order, transitions and chapter (story beat) markers live here.
 * Durations and text come from config.js; the action lives in scenes/*.js.
 */
import { defineFilm } from '../../engine/film.js';
import { filmHelpers } from '../../kit.js';
import { TEXT, TIMING, CAPTION } from './config.js';
import { WORLD_DEFS } from './world.js';
import * as setup from './scenes/setup.js';
import * as heist from './scenes/heist.js';
import * as getaway from './scenes/getaway.js';
import * as sky from './scenes/sky.js';
import * as finale from './scenes/finale.js';

const { titleCard, shot } = filmHelpers({ TIMING, CAPTION });

export default defineFilm({
  id: 'rare-or-weld-done',
  title: 'Rare or Weld Done?',
  width: 1280,
  height: 720,
  posterAt: 5600, // idle poster frame: the title card, fully revealed
  defs: WORLD_DEFS,

  chapters: [
    { id: 'intro', label: 'Opening', scene: 'c-studio' },
    { id: 'beat1', label: '1 · The newspaper', scene: 's-read' },
    { id: 'beat2', label: '2 · The great heist', scene: 'c-night' },
    { id: 'beat3', label: '3 · The impossible getaway', scene: 's-sack' },
    { id: 'beat4', label: '4 · The balloons', scene: 's-balloons' },
    { id: 'beat5', label: '5 · A brilliant realization', scene: 's-despair' },
    { id: 'beat6', label: '6 · The fence montage', scene: 's-posts' },
    { id: 'beat7', label: '7 · The perfect crime', scene: 'c-morning' },
    { id: 'beat8', label: '8 · ONE WEEK ONLY?', scene: 's-reread' },
  ],

  scenes: [
    titleCard('studio', TEXT.studio.map((t, i) => ({ t, size: [64, 52, 30][i], spacing: [8, 6, 8][i] })), { kind: 'studio', dy: 56 }, { in: 'iris', inMs: 700 }),
    titleCard('title', [{ t: TEXT.title[0], size: 128, spacing: 6 }, { t: TEXT.title[1], size: 140, spacing: 6 }], { kind: 'title', sub: TEXT.subtitle, dy: -34 }),
    shot('read', setup.read, { in: 'iris', irisIn: [50, 60] }),
    shot('paper', setup.paper),
    shot('plan', setup.plan),
    shot('grab', setup.grab, { out: 'iris', irisOut: [75, 62] }),

    // --- 2. the great heist
    titleCard('night', TEXT.night),
    shot('wall', heist.wall, { in: 'iris', irisIn: [10, 70] }),
    shot('arc', heist.arcShot),
    shot('cut', heist.cut),
    shot('squeeze', heist.squeeze),
    shot('vault', heist.vault),

    // --- 3. the impossible getaway
    shot('sack', getaway.sack),
    shot('kickRun', getaway.kickRun),
    shot('kick', getaway.kick),

    // --- 4. the balloons
    shot('balloons', sky.balloons),
    shot('rise', sky.rise),
    shot('pop', sky.pop),
    shot('crash', sky.crash),

    // --- 5. a brilliant realization
    shot('despair', finale.despair),
    titleCard('ifIcant', TEXT.ifIcant, { dialogue: true }),
    titleCard('illBring', TEXT.illBring, { dialogue: true }),

    // --- 6. the construction montage
    shot('posts', finale.posts),
    shot('iron', finale.iron),
    shot('gate', finale.gateBooth),
    shot('signUp', finale.signUp),
    shot('ready', finale.ready),

    // --- 7. the perfect crime
    titleCard('morning', TEXT.morning),
    shot('queue', finale.queue, { in: 'iris', irisIn: [70, 70] }),

    // --- 8. the locked final punchline
    shot('reread', finale.reread),
    shot('plate', finale.plateScene, { out: 'iris', irisOut: [28, 70], outMs: 1000 }),
    titleCard('end', TEXT.end, { kind: 'end', size: 120 }, { inMs: 700, outMs: 0, out: 'cut' }),
  ],
});
