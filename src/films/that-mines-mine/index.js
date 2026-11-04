/**
 * "That Mines Mine!" - film definition.
 *
 * Scene order, transitions and chapter (story beat) markers live here.
 * Durations and text come from config.js; the action lives in scenes/*.js.
 */
import { defineFilm } from '../../engine/film.js';
import { filmHelpers } from '../../kit.js';
import { TEXT, TIMING, CAPTION } from './config.js';
import { WORLD_DEFS } from './world.js';
import * as discovery from './scenes/discovery.js';
import * as rival from './scenes/rival.js';
import * as bonk from './scenes/bonk.js';
import * as mining from './scenes/mining.js';
import * as payoff from './scenes/payoff.js';

const { titleCard, shot } = filmHelpers({ TIMING, CAPTION });

export default defineFilm({
  id: 'that-mines-mine',
  title: 'That Mines Mine!',
  width: 1280,
  height: 720,
  posterAt: 5200, // idle poster frame: the title card, fully revealed
  defs: WORLD_DEFS,

  // The eight approved story beats (plus the opening) as jump points.
  chapters: [
    { id: 'intro', label: 'Opening', scene: 'c-studio' },
    { id: 'beat1', label: '1 · The discovery', scene: 's-trudge' },
    { id: 'beat2', label: '2 · Another claimant', scene: 'c-company' },
    { id: 'beat3', label: '3 · The argument', scene: 's-argue1' },
    { id: 'beat4', label: '4 · The bonk', scene: 's-idea' },
    { id: 'beat5', label: '5 · Mining montage', scene: 'c-work' },
    { id: 'beat6', label: '6 · Runaway cart', scene: 'c-cartPlans' },
    { id: 'beat7', label: '7 · Lucky rival', scene: 'c-behind' },
    { id: 'beat8', label: '8 · Punchline', scene: 's-proud' },
  ],

  scenes: [
    // --- opening
    titleCard('studio', TEXT.studio.map((t, i) => ({ t, size: [64, 52, 30][i], spacing: [8, 6, 8][i] })), { kind: 'studio', dy: 56 }, { in: 'iris', inMs: 700 }),
    titleCard('title', [{ t: TEXT.title[0], size: 128, spacing: 6 }, { t: TEXT.title[1], size: 150, spacing: 8 }], { kind: 'title', sub: TEXT.subtitle, dy: -34 }),
    titleCard('lonely', TEXT.lonely),

    // --- 1. the discovery
    shot('trudge', discovery.trudge, { in: 'iris', irisIn: [50, 62] }),
    shot('glitter', discovery.glitter),
    shot('stake', discovery.stake),

    // --- 2. another claimant
    titleCard('company', TEXT.company),
    shot('rival', rival.rival, { in: 'iris', irisIn: [70, 66] }),

    // --- 3. the argument
    shot('argue1', rival.argue1),
    titleCard('thatMine', TEXT.thatMine, { dialogue: true }),
    shot('argue2', rival.argue2),
    titleCard('noThatMine', TEXT.noThatMine, { dialogue: true }),

    // --- 4. the bonk
    shot('idea', bonk.idea),
    shot('bonk', bonk.bonk),

    // --- 5. productive mining montage
    titleCard('work', TEXT.work),
    shot('mineIn', mining.mineIn, { in: 'iris', irisIn: [60, 70] }),
    shot('cutterUp', mining.cutterUp),
    shot('cartFull', mining.cartFull),

    // --- 6. runaway cart
    titleCard('cartPlans', TEXT.cartPlans),
    shot('runaway', mining.runaway, { in: 'iris', irisIn: [50, 70] }),

    // --- 7. lucky rival
    titleCard('behind', TEXT.behind),
    shot('wake', payoff.wake, { in: 'iris', irisIn: [20, 80] }),

    // --- 8. the punchline
    shot('proud', payoff.proud, { in: 'iris', irisIn: [20, 70] }),
    titleCard('kept', TEXT.kept, { dialogue: true }),
    titleCard('other', TEXT.other, { dialogue: true }),
    shot('finale', payoff.finale, { in: 'iris', irisIn: [48, 52], out: 'iris', irisOut: [47, 52], outMs: 900 }),
    titleCard('end', TEXT.end, { kind: 'end', size: 120 }, { inMs: 700, outMs: 0, out: 'cut' }),
  ],
});
