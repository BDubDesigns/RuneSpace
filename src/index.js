/**
 * Public entry point of the film module.
 *
 *   import { createMoviePlayer, thatMinesMine } from './src/index.js';
 *
 * Stylesheets (load once): src/player/player.css, src/fx/effects.css, src/fx/film-look.css
 */
export { createMoviePlayer } from './player/player.js';
export { createTimeline } from './engine/timeline.js';
export { defineFilm } from './engine/film.js';
export { default as thatMinesMine } from './films/that-mines-mine/index.js';
