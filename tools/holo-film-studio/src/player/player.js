/**
 * Movie player: mounts a film into any container element and exposes a small API.
 *
 *   import { createMoviePlayer } from './src/player/player.js';
 *   const player = createMoviePlayer(containerEl, { film, captions: false, reducedMotion: 'auto' });
 *   player.play(); player.pause(); player.seek(12000); player.restart();
 *   player.skip();            // jump to the final frame
 *   player.destroy();         // remove DOM, animations, listeners
 *   player.on('state', (s) => ...)   // 'idle' | 'playing' | 'paused' | 'ended'
 *   player.on('time', (ms) => ...)   // while playing, and after seeks
 *   player.on('scene', (scene) => ...)
 *
 * The player owns DOM + controls. The film (content) is data; the timeline
 * (engine) owns all animation. Pass `controls: false` to embed the picture only
 * and drive it from your own UI.
 */
import { createTimeline } from '../engine/timeline.js';

const ICON = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  restart: '<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/>',
  skip: '<path d="M5 5v14l9-7zM16 5h3v14h-3z"/>',
  cc: '<path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm3.5 4.2A2.8 2.8 0 0 0 7.4 15c.9 0 1.6-.4 2-1.1l-1-.6c-.2.3-.5.5-1 .5a1.4 1.4 0 0 1 0-2.8c.5 0 .8.2 1 .5l1-.6c-.4-.7-1.1-1-2-1zm7 0a2.8 2.8 0 0 0-.1 5.8c.9 0 1.6-.4 2-1.1l-1-.6c-.2.3-.5.5-1 .5a1.4 1.4 0 0 1 0-2.8c.5 0 .8.2 1 .5l1-.6c-.4-.7-1.1-1-2-1z"/>',
  calm: '<path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  full: '<path d="M4 4h6v2H6v4H4zM14 4h6v6h-2V6h-4zM4 14h2v4h4v2H4zM18 14h2v6h-6v-2h4z"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">${ICON[k]}</svg>`;

const fmt = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function createMoviePlayer(container, options = {}) {
  const opts = { controls: true, captions: false, reducedMotion: 'auto', autoplay: false, keyboard: true, ...options };
  const listeners = {};
  const emit = (type, detail) => (listeners[type] || []).slice().forEach((fn) => fn(detail));

  let film = null;
  let built = null;
  let timeline = null;
  let unsubs = [];
  let sceneIndex = -1;
  let idle = true; // showing the poster frame, not started yet
  let captionsOn = !!opts.captions;
  let destroyed = false;
  let scrubbing = false;
  let resumeAfterScrub = false;

  const mql = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reducedPref = opts.reducedMotion === 'auto' ? !!(mql && mql.matches) : !!opts.reducedMotion;
  const onMql = () => {
    if (opts.reducedMotion === 'auto') setReducedMotion(mql.matches);
  };
  if (mql && mql.addEventListener) mql.addEventListener('change', onMql);

  /* ------------------------------------------------------------- DOM */
  const root = document.createElement('div');
  root.className = 'mm-player';
  root.dataset.state = 'idle';
  root.innerHTML = `
    <div class="mm-stage" tabindex="0" role="group" aria-roledescription="silent film player" aria-label="Movie">
      <div class="mm-frame" data-t="frame"><svg class="mm-svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true"></svg></div>
      <div class="mm-look" aria-hidden="true">
        <div class="mm-grain"></div><div class="mm-pulse"></div><div class="mm-flicker"></div>
        <div class="mm-scratch a"></div><div class="mm-scratch b"></div><div class="mm-scratch c"></div>
        <div class="mm-speck a"></div><div class="mm-speck b"></div><div class="mm-hair"></div>
        <div class="mm-vignette"></div>
      </div>
      <div class="mm-caption" aria-live="polite" hidden></div>
      <button class="mm-big" type="button" aria-label="Play">${icon('play')}</button>
    </div>
    <div class="mm-controls" role="group" aria-label="Playback controls">
      <button type="button" class="mm-btn" data-act="toggle" aria-label="Play">${icon('play')}</button>
      <button type="button" class="mm-btn" data-act="restart" aria-label="Restart" title="Restart">${icon('restart')}</button>
      <button type="button" class="mm-btn" data-act="skip" aria-label="Skip to end" title="Skip to end">${icon('skip')}</button>
      <input class="mm-scrub" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek">
      <span class="mm-time" aria-hidden="true">0:00 / 0:00</span>
      <button type="button" class="mm-btn mm-toggle" data-act="cc" aria-pressed="false" aria-label="Captions" title="Captions">${icon('cc')}</button>
      <button type="button" class="mm-btn mm-toggle" data-act="calm" aria-pressed="false" aria-label="Reduced motion" title="Reduced motion">${icon('calm')}</button>
      <button type="button" class="mm-btn" data-act="full" aria-label="Fullscreen" title="Fullscreen">${icon('full')}</button>
    </div>`;
  container.appendChild(root);
  if (!opts.controls) root.classList.add('mm-no-controls');

  const $ = (s) => root.querySelector(s);
  const stage = $('.mm-stage');
  const svg = $('.mm-svg');
  const bigBtn = $('.mm-big');
  const toggleBtn = $('[data-act="toggle"]');
  const scrub = $('.mm-scrub');
  const timeEl = $('.mm-time');
  const captionEl = $('.mm-caption');
  const ccBtn = $('[data-act="cc"]');
  const calmBtn = $('[data-act="calm"]');

  /* ------------------------------------------------------------- state */
  const getState = () => (idle ? 'idle' : timeline ? timeline.state : 'idle');

  function syncState() {
    const st = getState();
    root.dataset.state = st;
    const playing = st === 'playing';
    toggleBtn.innerHTML = icon(playing ? 'pause' : 'play');
    const label = playing ? 'Pause' : st === 'ended' ? 'Replay' : 'Play';
    toggleBtn.setAttribute('aria-label', label);
    bigBtn.setAttribute('aria-label', label);
    bigBtn.innerHTML = icon(st === 'ended' ? 'restart' : 'play');
    emit('state', st);
  }

  function syncTime(ms) {
    if (!built) return;
    const shown = idle ? 0 : ms;
    if (!scrubbing) scrub.value = String(Math.round((shown / built.duration) * 1000));
    scrub.style.setProperty('--p', `${(shown / built.duration) * 100}%`);
    timeEl.textContent = `${fmt(shown)} / ${fmt(built.duration)}`;
    scrub.setAttribute('aria-valuetext', `${fmt(shown)} of ${fmt(built.duration)}`);
    const idx = built.scenes.findIndex((s) => ms >= s.start && ms < s.end);
    const i = idx < 0 ? built.scenes.length - 1 : idx;
    if (i !== sceneIndex) {
      sceneIndex = i;
      const sc = built.scenes[i];
      if (captionsOn) captionEl.textContent = sc.caption;
      emit('scene', sc);
    }
  }

  function setCaptions(on) {
    captionsOn = !!on;
    captionEl.hidden = !captionsOn;
    ccBtn.setAttribute('aria-pressed', String(captionsOn));
    if (captionsOn && built && sceneIndex >= 0) captionEl.textContent = built.scenes[sceneIndex].caption;
  }

  function setReducedMotion(on) {
    reducedPref = !!on;
    calmBtn.setAttribute('aria-pressed', String(reducedPref));
    // The timeline owns the `is-reduced` class (on the stage) and re-collects the CSS effect
    // animations right after toggling it. Don't toggle it anywhere else: a late style change
    // would spawn effect animations outside the master clock.
    if (timeline) timeline.setReducedMotion(reducedPref);
  }

  /* ------------------------------------------------------------- film */
  function load(nextFilm) {
    teardownTimeline();
    film = nextFilm;
    built = film.build();
    stage.setAttribute('aria-label', film.title || 'Movie');
    svg.setAttribute('viewBox', `0 0 ${film.width} ${film.height}`);
    root.style.setProperty('--mm-aspect', `${film.width} / ${film.height}`);
    svg.innerHTML = built.markup;
    timeline = createTimeline(stage, { duration: built.duration, cues: built.cues, reducedMotion: reducedPref });
    unsubs = [
      timeline.on('time', syncTime),
      timeline.on('state', () => {
        idle = false;
        syncState();
      }),
    ];
    idle = true;
    sceneIndex = -1;
    timeline.seek(film.posterAt || 0); // poster frame
    setCaptions(captionsOn);
    setReducedMotion(reducedPref);
    syncTime(film.posterAt || 0);
    syncState();
    emit('load', film);
    if (opts.autoplay) api.play();
    return api;
  }

  function teardownTimeline() {
    unsubs.forEach((u) => u());
    unsubs = [];
    if (timeline) timeline.destroy();
    timeline = null;
    svg.innerHTML = '';
  }

  /* -------------------------------------------------------------- API */
  const api = {
    load,
    play() {
      if (!timeline) return api;
      if (idle) {
        idle = false;
        timeline.seek(0);
      }
      timeline.play();
      syncState();
      return api;
    },
    pause() {
      if (timeline) timeline.pause();
      return api;
    },
    toggle() {
      return getState() === 'playing' ? api.pause() : api.play();
    },
    /** Jump to `ms`. Stays paused if paused, keeps playing if playing. */
    seek(ms) {
      if (!timeline) return api;
      const wasIdle = idle;
      idle = false;
      timeline.seek(ms);
      if (wasIdle && timeline.state === 'idle') timeline.pause(); // leaves 'paused' state at the seek point
      syncState();
      syncTime(timeline.time);
      return api;
    },
    restart() {
      if (!timeline) return api;
      idle = false;
      timeline.restart();
      syncState();
      return api;
    },
    /** Jump to the end card. */
    skip() {
      if (!timeline) return api;
      idle = false;
      timeline.skipToEnd();
      syncState();
      return api;
    },
    setCaptions,
    setReducedMotion,
    on(type, fn) {
      (listeners[type] ||= []).push(fn);
      return () => api.off(type, fn);
    },
    off(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    get state() {
      return getState();
    },
    get time() {
      return timeline ? timeline.time : 0;
    },
    get duration() {
      return built ? built.duration : 0;
    },
    get scenes() {
      return built ? built.scenes : [];
    },
    get chapters() {
      return built ? built.chapters : [];
    },
    get reducedMotion() {
      return reducedPref;
    },
    get captions() {
      return captionsOn;
    },
    get element() {
      return root;
    },
    get stage() {
      return stage;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      teardownTimeline();
      if (mql && mql.removeEventListener) mql.removeEventListener('change', onMql);
      document.removeEventListener('fullscreenchange', onFs);
      root.remove();
      Object.keys(listeners).forEach((k) => delete listeners[k]);
    },
  };

  /* --------------------------------------------------------- controls */
  const onFs = () => root.classList.toggle('is-fullscreen', document.fullscreenElement === root);
  document.addEventListener('fullscreenchange', onFs);

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn === bigBtn) return api.toggle();
    switch (btn.dataset.act) {
      case 'toggle': return api.toggle();
      case 'restart': return api.restart();
      case 'skip': return api.skip();
      case 'cc': return setCaptions(!captionsOn);
      case 'calm': return setReducedMotion(!reducedPref);
      case 'full':
        if (document.fullscreenElement) document.exitFullscreen();
        else if (root.requestFullscreen) root.requestFullscreen();
        return undefined;
    }
    return undefined;
  });
  stage.addEventListener('click', (e) => {
    if (e.target === bigBtn || bigBtn.contains(e.target)) return;
    api.toggle();
  });

  const scrubTo = () => {
    if (!built) return;
    const ms = (Number(scrub.value) / 1000) * built.duration;
    api.seek(ms);
  };
  scrub.addEventListener('pointerdown', () => {
    scrubbing = true;
    resumeAfterScrub = getState() === 'playing';
    if (resumeAfterScrub) timeline.pause();
  });
  scrub.addEventListener('input', scrubTo);
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    if (resumeAfterScrub) api.play();
  };
  scrub.addEventListener('pointerup', endScrub);
  scrub.addEventListener('pointercancel', endScrub);
  scrub.addEventListener('blur', endScrub);

  if (opts.keyboard) {
    root.addEventListener('keydown', (e) => {
      if (e.target === scrub && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return; // native range step
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'k') {
        if (e.target.closest('button')) return;
        e.preventDefault();
        api.toggle();
      } else if (k === 'arrowleft') api.seek(api.time - 5000);
      else if (k === 'arrowright') api.seek(api.time + 5000);
      else if (k === 'home') api.restart(), api.pause();
      else if (k === 'end') api.skip();
      else if (k === 'r') api.restart();
      else if (k === 'c') setCaptions(!captionsOn);
      else if (k === 'f') root.requestFullscreen && root.requestFullscreen();
      else return;
      if (k !== ' ' && k !== 'k') e.preventDefault();
    });
  }

  if (opts.film) load(opts.film);
  return api;
}
