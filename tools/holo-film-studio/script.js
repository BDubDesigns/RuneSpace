import { createMoviePlayer } from './src/player/player.js';
import { FILMS, listFilms, loadFilm } from './src/films/index.js';

const params = new URLSearchParams(location.search);
if (params.get('bare') === '1') document.body.classList.add('bare');

const filmId = params.get('film') || FILMS[0].id;
const screen = document.getElementById('screen');
const beats = document.getElementById('beats');

// Film picker: every visible film, plus the current one if it is hidden (e.g. ?film=template).
// Not shown at all while there is only a single film to pick.
const picker = document.getElementById('films');
const choices = listFilms().slice();
const current = FILMS.find((f) => f.id === filmId);
if (current && !choices.includes(current)) choices.push(current);
if (choices.length > 1) {
  for (const f of choices) {
    const a = document.createElement('a');
    a.href = `?film=${encodeURIComponent(f.id)}`;
    a.textContent = f.title;
    if (f.id === filmId) a.setAttribute('aria-current', 'page');
    picker.appendChild(a);
  }
}

async function main() {
  let film;
  try {
    film = await loadFilm(filmId);
  } catch (err) {
    screen.textContent = String(err.message || err);
    screen.className = 'error';
    return;
  }
  document.title = `${film.title} · RuneSpace holo-drive-in`;
  document.getElementById('title').textContent = film.title;

  const player = createMoviePlayer(screen, {
    film,
    captions: params.get('cc') === '1',
    reducedMotion: params.has('reduced') ? params.get('reduced') === '1' : 'auto',
    controls: params.get('ui') !== '0',
  });

  for (const ch of player.chapters) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = ch.label;
    b.addEventListener('click', () => player.seek(ch.at).play());
    beats.appendChild(b);
  }

  if (params.has('t')) player.seek(Number(params.get('t')));
  if (params.get('autoplay') === '1') player.play();

  window.__film = player; // handy for the console and for capture / verify scripts
  return player;
}

window.__filmReady = main(); // promise: await it before touching window.__film from a script
