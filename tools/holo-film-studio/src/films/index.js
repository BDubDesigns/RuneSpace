/**
 * Film registry. One entry per film; `load()` is a lazy dynamic import, so a host (RuneSpace's
 * Next.js app, the demo page, the tests) only pays for the films it actually opens.
 *
 *   import { loadFilm, listFilms } from './src/films/index.js';
 *   const film = await loadFilm('that-mines-mine');
 *   createMoviePlayer(el, { film });
 *
 * To add a film: create src/films/<id>/index.js (default export = defineFilm(...)) and add one
 * line below. `id` MUST equal the film's own `id`; the automated tests enforce that.
 * `hidden: true` keeps a film out of the demo page's film list (it still loads via ?film=<id>).
 */
export const FILMS = [
  { id: 'that-mines-mine', title: 'That Mines Mine!', load: () => import('./that-mines-mine/index.js') },
  { id: 'rare-or-weld-done', title: 'Rare or Weld Done?', load: () => import('./rare-or-weld-done/index.js') },
  // The three pre-roll commercials the Holo Drive-In plays before a film (issue #491). They are
  // 15-second spots, not features, so the demo page's film picker lists them last.
  { id: 'commercial-dewhat', title: 'DeWHAT?', kind: 'commercial', load: () => import('./commercial-dewhat/index.js') },
  { id: 'commercial-visit-skatboll', title: 'Visit Skatboll!', kind: 'commercial', load: () => import('./commercial-visit-skatboll/index.js') },
  { id: 'commercial-fedhex', title: 'FedHex', kind: 'commercial', load: () => import('./commercial-fedhex/index.js') },
  { id: 'template', title: 'Template Film', hidden: true, load: () => import('./_template/index.js') },
];

/** Films to show in a picker (hidden ones omitted unless asked for). */
export const listFilms = ({ includeHidden = false } = {}) => FILMS.filter((f) => includeHidden || !f.hidden);

/** Resolve a registered film id to its defineFilm() object. Rejects for an unknown id. */
export async function loadFilm(id) {
  const entry = FILMS.find((f) => f.id === id);
  if (!entry) throw new Error(`Unknown film "${id}". Registered: ${FILMS.map((f) => f.id).join(', ')}`);
  return (await entry.load()).default;
}
