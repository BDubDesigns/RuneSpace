import { createMoviePlayer } from './src/player/player.js';
import film from './src/films/that-mines-mine/index.js';

const params = new URLSearchParams(location.search);
if (params.get('bare') === '1') document.body.classList.add('bare');
const player = createMoviePlayer(document.getElementById('screen'), {
  film,
  captions: params.get('cc') === '1',
  reducedMotion: params.has('reduced') ? params.get('reduced') === '1' : 'auto',
  controls: params.get('ui') !== '0',
});

const beats = document.getElementById('beats');
for (const ch of player.chapters) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = ch.label;
  b.addEventListener('click', () => player.seek(ch.at).play());
  beats.appendChild(b);
}

if (params.has('t')) player.seek(Number(params.get('t')));
if (params.get('autoplay') === '1') player.play();

window.__film = player; // handy for the console and for capture scripts
