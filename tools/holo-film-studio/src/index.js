/**
 * Public entry point of the film module.
 *
 *   import { createMoviePlayer, loadFilm } from './src/index.js';
 *   const player = createMoviePlayer(el, { film: await loadFilm('that-mines-mine') });
 *
 * Stylesheets (load once): src/player/player.css, src/fx/effects.css, src/fx/film-look.css
 *
 * `thatMinesMine` is kept as a static export for the original embedding recipe. It makes any
 * import of this barrel bundle that film; new films should be opened through loadFilm() instead
 * (lazy). Nothing here touches `document` / `window` at import time, so it is safe to import
 * during SSR; only createMoviePlayer() / createTimeline() need a browser.
 */
export { createMoviePlayer } from './player/player.js';
export { createTimeline } from './engine/timeline.js';
export { defineFilm } from './engine/film.js';
export { FILMS, listFilms, loadFilm } from './films/index.js';
export { default as thatMinesMine } from './films/that-mines-mine/index.js';
