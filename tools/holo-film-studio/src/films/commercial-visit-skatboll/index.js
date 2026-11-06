/**
 * "Visit Skatboll!" commercial (issue #491, Stage D): an in-world, silent, 15-second pre-roll
 * built from real approved 4:1 location art with horizontal pans and tourism-board lettering.
 */
import { defineFilm } from '../../engine/film.js';
import { filmHelpers } from '../../kit.js';
import { ART, TIMING, CAPTION } from './config.js';
import { WORLD_DEFS } from './world.js';
import { nightlife, scenery, hospitality, finale } from './scenes/segments.js';

const { shot } = filmHelpers({ TIMING, CAPTION });

export default defineFilm({
  id: 'commercial-visit-skatboll',
  title: 'Visit Skatboll!',
  width: 1280,
  height: 720,
  posterAt: 14300, // the closing title with its stamp
  defs: WORLD_DEFS,
  // The art the host should have decoded before the spot starts, so no segment opens on a blank frame.
  assets: Object.values(ART).map((art) => art.src),
  chapters: [
    { id: 'nightlife', label: 'Nightlife', scene: 's-nightlife' },
    { id: 'scenery', label: 'Scenery', scene: 's-scenery' },
    { id: 'hospitality', label: 'Hospitality', scene: 's-hospitality' },
    { id: 'finale', label: 'It’s not all work', scene: 's-finale' },
  ],
  scenes: [shot('nightlife', nightlife), shot('scenery', scenery), shot('hospitality', hospitality), shot('finale', finale)],
});
