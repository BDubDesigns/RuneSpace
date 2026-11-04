/**
 * Template film - editable content. Copy this folder to src/films/<your-film>/ to start a new film
 * (see MOVIE_AUTHORING_GUIDE.md, "Creating a new film").
 *
 * TEXT    every title card and caption string
 * TIMING  scene durations in ms (scene starts are the running sum, in the order set by index.js)
 * CAPTION the CC text for each scene; every id in TIMING needs one
 */
export const TEXT = {
  title: ['TEMPLATE', 'FILM'],
  subtitle: 'COPY ME TO START A NEW MOVIE',
  gag: ['A PROSPECTOR WALKS', 'INTO A GAG.'],
  end: ['THE END'],
};

export const TIMING = {
  title: 4200,
  gag: 3200,
  walk: 5200,
  end: 3200,
};

export const CAPTION = {
  title: 'Template film. Copy me to start a new movie.',
  gag: 'A prospector walks into a gag.',
  walk: 'A prospector walks in, spots something, gets excited and puffs some smoke.',
  end: 'The End.',
};
