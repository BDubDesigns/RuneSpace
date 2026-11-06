/**
 * The one place the shipped app reaches into the Holo Film Studio (#491, `docs/holo-film-studio.md`).
 *
 * The studio is an independently operated development tool, and only its `src/` is the module it
 * ships: the engine, the player, the films and their three stylesheets. This adapter consumes
 * exactly that supported public API (`createMoviePlayer`, `loadFilm`) and its stylesheets, and
 * nothing else: not its demo page, its dev server, its authoring helpers, its tests or its
 * headless QA tooling. `tests/unit/holo-film-studio-boundary.test.ts` fails if any other shipped
 * file imports the studio, or if this one imports anything outside `src/`.
 *
 * It is imported only by the viewer, which is itself loaded on demand, so none of this reaches a
 * player until they open a film. Each film is its own lazily loaded chunk.
 */
import "@/tools/holo-film-studio/src/player/player.css";
import "@/tools/holo-film-studio/src/fx/effects.css";
import "@/tools/holo-film-studio/src/fx/film-look.css";

export {
  createMoviePlayer,
  loadFilm,
  type MoviePlayer,
} from "@/tools/holo-film-studio/src/index.js";
