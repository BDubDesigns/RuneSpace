/**
 * Seekable movie timeline built on the native Web Animations API.
 *
 * One master clock, many animations. Everything that moves on screen is either
 *
 *   1. a *cue*   – `{ at, dur, target, keyframes, ... }` compiled to element.animate(), or
 *   2. a CSS keyframe animation that reads its start from `--at` / `--dur`
 *      (dust, sparks, film grain...) and is discovered via root.getAnimations().
 *
 * Both kinds are collected into one list and driven together, so pause / seek /
 * restart act on *every* visual effect, not only the characters. There are no
 * setTimeout chains: time lives in the master animation's `currentTime`.
 *
 * Conventions (same spirit as RuneSpace's scene-cue player: `delay: cue.at`,
 * `fill: forwards`, one target attribute per layer):
 *   - targets are elements carrying `data-t="name"` inside `root`
 *   - a cue animating several CSS properties is split into one animation per
 *     property, so chains of cues on the same property never fight each other
 *   - for each (element, property) the earliest cue fills backwards + forwards,
 *     later cues fill forwards only. Seeking anywhere therefore restores the
 *     exact pose the element should have at that moment.
 *   - `dur` is the duration of ONE iteration; total length is dur * iterations.
 *   - `reduce: 'skip'` drops the cue in reduced-motion mode, `'snap'` replaces
 *     it with an instant jump to its end state.
 */

const RESERVED = new Set(['offset', 'easing', 'composite', 'computedOffset']);
const isCssTransition = (a) => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition;

export function createTimeline(root, { duration, cues = [], reducedMotion = false } = {}) {
  const listeners = {};
  const emit = (type, detail) => (listeners[type] || []).slice().forEach((fn) => fn(detail));
  const on = (type, fn) => {
    (listeners[type] ||= []).push(fn);
    return () => off(type, fn);
  };
  const off = (type, fn) => {
    listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
  };

  let state = 'idle'; // idle | playing | paused | ended
  let reduced = !!reducedMotion;
  let destroyed = false;
  let raf = 0;
  let master = null;
  let anims = [];
  let cueAnims = [];
  const warned = new Set();

  const targets = new Map();
  root.querySelectorAll('[data-t]').forEach((el) => {
    const key = el.dataset.t;
    if (!targets.has(key)) targets.set(key, []);
    targets.get(key).push(el);
  });

  const clock = document.createElement('i');
  clock.className = 'mm-clock';
  clock.setAttribute('aria-hidden', 'true');
  root.appendChild(clock);

  function resolve(target) {
    if (target instanceof Element) return [target];
    const found = targets.get(target);
    if (!found && !warned.has(target)) {
      warned.add(target);
      console.warn(`[movie] cue target not found: "${target}"`);
    }
    return found || [];
  }

  function compile() {
    cueAnims.forEach((a) => a.cancel());
    cueAnims = [];
    if (master) master.cancel();
    master = clock.animate([{ opacity: 1 }, { opacity: 1 }], { duration, fill: 'both' });
    master.onfinish = () => {
      if (state === 'playing') finishPlayback();
    };

    const seen = new WeakMap(); // element -> Set(prop)
    const ordered = cues
      .map((cue, i) => ({ cue, i }))
      .sort((a, b) => a.cue.at - b.cue.at || a.i - b.i)
      .map((x) => x.cue);

    for (const cue of ordered) {
      if (reduced && cue.reduce === 'skip') continue;
      let frames = cue.keyframes;
      let easing = cue.easing || 'linear';
      let iterations = cue.iterations || 1;
      if (reduced && cue.reduce === 'snap') {
        frames = [frames[0], frames[frames.length - 1]];
        easing = 'steps(1, end)';
        iterations = 1;
      }
      const props = new Set();
      frames.forEach((k) => Object.keys(k).forEach((p) => RESERVED.has(p) || props.add(p)));

      for (const el of resolve(cue.target)) {
        if (!seen.has(el)) seen.set(el, new Set());
        const done = seen.get(el);
        for (const prop of props) {
          const pf = frames
            .filter((k) => prop in k)
            .map((k) => {
              const f = { [prop]: k[prop] };
              if (k.offset != null) f.offset = k.offset;
              if (k.easing) f.easing = k.easing;
              return f;
            });
          if (pf.length === 1) pf.push({ ...pf[0] });
          const first = !done.has(prop);
          done.add(prop);
          const a = el.animate(pf, {
            delay: cue.at,
            duration: cue.dur,
            easing,
            iterations,
            direction: cue.direction || 'normal',
            fill: cue.fill || (first ? 'both' : 'forwards'),
          });
          // Finished animations that a later one overrides are "replaceable": the browser
          // silently removes them, and a removed animation can never be seeked back to.
          // persist() keeps every cue alive so replay / scrub / skip always restore the scene.
          a.persist();
          a.pause();
          cueAnims.push(a);
        }
      }
    }

    root.classList.toggle('is-reduced', reduced);
    // CSS keyframe animations (dust, sparks, film grain, ...) join the same clock.
    const css = root
      .getAnimations({ subtree: true })
      .filter((a) => a !== master && !cueAnims.includes(a) && !isCssTransition(a));
    anims = [master, ...cueAnims, ...css];
    anims.forEach((a) => a.pause());
  }

  const time = () => Math.min(duration, Math.max(0, Number(master.currentTime) || 0));
  const setTime = (t) => anims.forEach((a) => (a.currentTime = t));

  function resume() {
    const t = time();
    for (const a of anims) {
      // Never play() an animation that is already past its end: play() would rewind it.
      if (t < a.effect.getComputedTiming().endTime) a.play();
      else a.pause();
    }
  }

  function loop() {
    if (state !== 'playing') return;
    emit('time', time());
    raf = requestAnimationFrame(loop);
  }

  function setState(next) {
    if (state === next) return;
    state = next;
    emit('state', state);
  }

  function finishPlayback() {
    cancelAnimationFrame(raf);
    setTime(duration);
    anims.forEach((a) => a.pause());
    emit('time', duration);
    setState('ended');
  }

  const api = {
    on,
    off,
    get state() {
      return state;
    },
    get time() {
      return time();
    },
    get duration() {
      return duration;
    },
    get reducedMotion() {
      return reduced;
    },

    play() {
      if (destroyed) return;
      if (state === 'ended' || time() >= duration) setTime(0);
      resume();
      setState('playing');
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    },

    pause() {
      if (destroyed) return;
      if (state === 'idle') return setState('paused');
      if (state !== 'playing') return;
      cancelAnimationFrame(raf);
      const t = time();
      anims.forEach((a) => a.pause());
      setTime(t); // freeze on the exact frame, not one frame later (pause commits asynchronously)
      setState('paused');
      emit('time', t);
    },

    /** Jump to `ms`, restoring the exact visual state. Keeps playing if it was playing. */
    seek(ms) {
      if (destroyed) return;
      const t = Math.min(duration, Math.max(0, ms));
      setTime(t);
      if (t >= duration) {
        cancelAnimationFrame(raf);
        anims.forEach((a) => a.pause());
        emit('time', t);
        setState('ended');
        return;
      }
      if (state === 'playing') resume();
      else if (state === 'ended') setState('paused');
      else if (state === 'idle') {
        /* stays idle: a poster frame, not playback */
      }
      emit('time', t);
    },

    restart() {
      api.seek(0);
      api.play();
    },

    skipToEnd() {
      api.seek(duration);
    },

    setReducedMotion(value) {
      value = !!value;
      if (value === reduced || destroyed) return;
      const t = time();
      const wasPlaying = state === 'playing';
      reduced = value;
      cancelAnimationFrame(raf);
      compile();
      setTime(t);
      if (wasPlaying) {
        resume();
        raf = requestAnimationFrame(loop);
      }
      emit('reducedmotion', reduced);
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf);
      anims.forEach((a) => a.cancel());
      clock.remove();
      root.classList.remove('is-reduced');
      Object.keys(listeners).forEach((k) => delete listeners[k]);
    },
  };

  compile();
  setTime(0);
  return api;
}
