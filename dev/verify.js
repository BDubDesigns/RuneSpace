/**
 * In-browser verification of one film against the real engine (Web Animations API).
 * Used by dev/verify.html (open it by hand, or let `npm run verify` drive it headless).
 *
 *   runChecks('that-mines-mine') -> { film, ok, results: [{ name, ok, detail }], ms }
 *
 * The central idea: playback is a pure function of time, so a "fingerprint" of every animated
 * element's computed transform / opacity / visibility / clip-path at time t must be identical
 * however we arrive at t (forward, backward, jump, after play, after replay, after toggling
 * reduced motion). Anything that breaks that is a seek/replay bug.
 */
import { createMoviePlayer } from '../src/player/player.js';
import { loadFilm } from '../src/films/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Hash of the whole picture's animated state. */
function fingerprint(stage) {
  let s = '';
  for (const el of stage.querySelectorAll('[data-t], .fx, .fx-orbx, .fx-orby, .mm-look *')) {
    const cs = getComputedStyle(el);
    // display:none elements (decorative fx in reduced motion) are not rendered; browsers report stale
    // animated values for them, so only their hidden-ness counts.
    s += cs.display === 'none' ? 'none;' : `${cs.transform}|${cs.opacity}|${cs.visibility}|${cs.clipPath};`;
  }
  return hash(s);
}

function sampleTimes(player) {
  const set = new Set([0, player.duration]);
  for (const s of player.scenes) {
    [s.start, s.start + 1, s.end - 1, s.start + (s.end - s.start) / 2, s.start + (s.end - s.start) * 0.83].forEach((t) => set.add(Math.round(Math.min(player.duration, Math.max(0, t)))));
  }
  return [...set].sort((a, b) => a - b);
}

const shuffled = (arr, seed = 7) => {
  const a = arr.slice();
  let x = seed;
  for (let i = a.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const running = (stage) => stage.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length;

export async function runChecks(filmId, { onProgress = () => {} } = {}) {
  const t0 = performance.now();
  const results = [];
  const check = async (name, fn) => {
    onProgress(name);
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail: detail || '' });
    } catch (err) {
      results.push({ name, ok: false, detail: String((err && err.message) || err) });
    }
  };
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  // collect engine warnings (a missing cue target is a console.warn, not an exception)
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => {
    warnings.push(a.join(' '));
    realWarn.apply(console, a);
  };

  const host = document.getElementById('host');
  host.innerHTML = '';
  let player;
  let film;
  try {
    film = await loadFilm(filmId);
    player = createMoviePlayer(host, { film, reducedMotion: false });
  } catch (err) {
    console.warn = realWarn;
    return { film: filmId, ok: false, results: [{ name: 'load film', ok: false, detail: String(err.message || err) }], ms: 0 };
  }
  const stage = player.stage;
  const times = sampleTimes(player);

  await check('loads: idle poster frame, duration, no cue-target warnings', () => {
    assert(player.state === 'idle', `state ${player.state}`);
    assert(player.duration > 0, 'duration');
    assert(Math.abs(player.time - (film.posterAt || 0)) < 2, `poster time ${player.time} vs ${film.posterAt}`);
    assert(warnings.filter((w) => w.includes('[movie]')).length === 0, warnings.join(' | '));
    return `${(player.duration / 1000).toFixed(1)} s, ${player.scenes.length} scenes, ${stage.getAnimations({ subtree: true }).length} animations`;
  });

  // fingerprints by arrival order
  const fpAt = (t) => {
    player.seek(t);
    return fingerprint(stage);
  };
  const forward = new Map(times.map((t) => [t, fpAt(t)]));
  await check('seek determinism: forward = backward = shuffled jumps', () => {
    const bad = [];
    const rev = times.slice().reverse().map((t) => [t, fpAt(t)]);
    const shuf = shuffled(times).map((t) => [t, fpAt(t)]);
    for (const [t, f] of [...rev, ...shuf]) if (f !== forward.get(t)) bad.push(t);
    assert(bad.length === 0, `picture differs by seek order at: ${[...new Set(bad)].slice(0, 6).join(', ')} ms`);
    return `${times.length} sample times, ${stage.querySelectorAll('[data-t], .fx').length} animated elements`;
  });

  await check('seek is stable: re-seeking the same time repeats the picture', () => {
    for (const t of times.filter((_, i) => i % 4 === 0)) {
      assert(fpAt(t) === forward.get(t) && fpAt(t) === forward.get(t), `unstable at ${t}`);
    }
  });

  await check('exactly one shot visible at every scene boundary and midpoint', () => {
    const shots = [...stage.querySelectorAll('.mm-shot')];
    for (const t of times) {
      player.seek(t);
      const n = shots.filter((s) => getComputedStyle(s).visibility === 'visible').length;
      assert(n === 1, `${n} shots visible at ${t} ms`);
    }
    return `${shots.length} shots`;
  });

  await check('every character shows exactly one face at all sample times', () => {
    const groups = new Map();
    stage.querySelectorAll('[data-t*=".f."]').forEach((el) => {
      const m = el.dataset.t.match(/^(.*)\.f\.\w+$/);
      if (m) (groups.get(m[1]) || groups.set(m[1], []).get(m[1])).push(el);
    });
    if (groups.size === 0) return 'no faces in this film';
    for (const t of times) {
      player.seek(t);
      for (const [who, els] of groups) {
        const on = els.filter((e) => Number(getComputedStyle(e).opacity) > 0.5).length;
        assert(on === 1, `${who} shows ${on} faces at ${t} ms`);
      }
    }
    return `${groups.size} characters`;
  });

  await check('player API: seek keeps paused/playing state; idle seek becomes paused', async () => {
    player.load(film); // back to idle
    assert(player.state === 'idle', 'idle after load');
    player.seek(8000);
    assert(player.state === 'paused', `seek from idle -> ${player.state}`);
    player.play();
    assert(player.state === 'playing', 'play');
    player.seek(9000);
    assert(player.state === 'playing', `seek while playing -> ${player.state}`);
    player.pause();
    assert(player.state === 'paused', 'pause');
    player.seek(1000);
    assert(player.state === 'paused', `seek while paused -> ${player.state}`);
    player.skip();
    assert(player.state === 'ended' && player.time === player.duration, `skip -> ${player.state} @ ${player.time}`);
    assert(fingerprint(stage) === forward.get(player.duration), 'skip frame differs from seek(duration)');
  });

  const live = !document.hidden;
  await check('pause freezes every animation on the exact frame (needs a visible page)', async () => {
    if (!live) return 'skipped: page hidden';
    const at = Math.min(20000, player.duration * 0.3);
    player.seek(at);
    player.play();
    await sleep(600);
    player.pause();
    const t1 = player.time;
    const f1 = fingerprint(stage);
    await sleep(400);
    assert(player.time === t1, `time moved while paused: ${t1} -> ${player.time}`);
    assert(fingerprint(stage) === f1, 'picture changed while paused (a CSS effect is not on the clock?)');
    assert(running(stage) === 0, `${running(stage)} animations still running while paused`);
    assert(t1 > at + 300, `playback did not advance (${at} -> ${t1})`);
  });

  await check('playback tracks wall-clock time (needs a visible page)', async () => {
    if (!live) return 'skipped: page hidden';
    player.seek(3000);
    const w0 = performance.now();
    player.play();
    await sleep(1000);
    const dt = player.time - 3000;
    const wall = performance.now() - w0;
    player.pause();
    assert(dt > wall * 0.8 && dt < wall * 1.25, `film advanced ${dt.toFixed(0)} ms in ${wall.toFixed(0)} ms of wall time`);
    return `${dt.toFixed(0)} ms film / ${wall.toFixed(0)} ms wall`;
  });

  await check('no effect is lost after real playback mixed with scrubbing, chapter jumps, skip and replay (needs a visible page)', async () => {
    if (!live) return 'skipped: page hidden';
    // The iris / fade `frame` cues, the film-look overlays and the CSS effects must come back after any sequence of controls.
    // Watch a little, jump around WHILE playing, skip to the end, replay, then every sample frame must equal its first viewing.
    player.seek(0);
    player.play();
    await sleep(500);
    for (const f of [0.55, 0.2, 0.8, 0.1]) {
      player.seek(player.duration * f);
      await sleep(180);
    }
    for (const c of player.chapters) {
      player.seek(c.at);
      await sleep(40);
    }
    player.skip();
    await sleep(100);
    player.restart();
    await sleep(400);
    player.pause();
    const bad = times.filter((t) => fpAt(t) !== forward.get(t));
    assert(bad.length === 0, `picture differs from the first viewing at: ${bad.slice(0, 6).join(', ')} ms`);
    const look = [...stage.querySelectorAll('.mm-look *')].flatMap((e) => e.getAnimations());
    assert(look.length > 0, 'the film-look overlay animations are gone');
    player.play();
    await sleep(150);
    const lookRunning = look.filter((a) => a.playState === 'running').length;
    player.pause();
    assert(lookRunning === look.length, `only ${lookRunning} of ${look.length} film-look animations run after the controls were used`);
    return `${times.length} frames match; ${look.length} overlay animations alive`;
  });

  await check('natural end, replay, and restart return to identical frames (needs a visible page)', async () => {
    if (!live) return 'skipped: page hidden';
    const ref = fpAt(Math.min(10000, player.duration / 2));
    player.seek(player.duration - 1100);
    player.play();
    const w = performance.now();
    while (player.state !== 'ended' && performance.now() - w < 4000) await sleep(50);
    assert(player.state === 'ended', `did not end by itself (state ${player.state} @ ${player.time})`);
    assert(player.time === player.duration, 'time at end');
    assert(fingerprint(stage) === forward.get(player.duration), 'final frame differs from seek(duration)');
    player.play(); // replay from the end
    await sleep(250);
    assert(player.state === 'playing' && player.time < 900, `replay did not restart (state ${player.state}, t=${player.time})`);
    player.restart();
    await sleep(120);
    assert(player.time < 600, `restart() left time at ${player.time}`);
    player.pause();
    assert(fpAt(Math.min(10000, player.duration / 2)) === ref, 'picture after replay differs from first viewing');
  });

  await check('reduced motion: rebuilds in place, drops decoration, toggles back to the identical picture', () => {
    const t = times[Math.floor(times.length / 2)];
    player.seek(t);
    const full = fingerprint(stage);
    player.setReducedMotion(true);
    assert(stage.classList.contains('is-reduced'), 'is-reduced class missing');
    assert(Math.abs(player.time - t) < 2, `time moved on toggle: ${t} -> ${player.time}`);
    const deco = [...stage.querySelectorAll('.fx:not(.fx-keep)')];
    assert(deco.every((e) => getComputedStyle(e).display === 'none'), 'decorative fx still displayed');
    assert(running(stage) === 0, 'animations running while paused in reduced mode');
    const redFwd = times.map((x) => [x, fpAt(x)]);
    const redRev = times.slice().reverse().map((x) => [x, fpAt(x)]);
    const redMap = new Map(redFwd);
    const bad = redRev.filter(([x, f]) => redMap.get(x) !== f).map(([x]) => x);
    assert(bad.length === 0, `reduced-motion seek is order dependent at ${bad.slice(0, 5).join(', ')}`);
    player.setReducedMotion(false);
    assert(!stage.classList.contains('is-reduced'), 'is-reduced class stuck');
    player.seek(t);
    assert(fingerprint(stage) === full, 'full-motion picture differs after toggling reduced motion off');
    return `${deco.length} decorative effects hidden`;
  });

  await check('load() twice leaks no animations; destroy() cancels everything', () => {
    const count = () => document.getAnimations().length;
    player.load(film);
    const a = count();
    player.load(film);
    const b = count();
    assert(a === b, `animation count grew across reload: ${a} -> ${b}`);
    // the player chrome's own CSS layers must survive a film swap and stay on the master clock
    for (const sel of ['.mm-grain', '.mm-flicker', '.mm-vignette', '.mm-svg']) {
      const anims = stage.querySelector(sel).getAnimations();
      assert(anims.length > 0, `${sel} lost its animation after load() (timeline.destroy must not cancel adopted CSS animations)`);
      assert(anims.every((x) => x.playState !== 'running'), `${sel} animates off the master clock while paused`);
    }
    player.seek(5000);
    player.destroy();
    assert(host.querySelector('.mm-player') === null, 'player DOM left behind');
    const leftover = document.getAnimations().filter((x) => x.effect && x.effect.target && !x.effect.target.isConnected).length;
    assert(leftover === 0, `${leftover} animations still alive after destroy()`);
    return `${a} live animations per loaded film`;
  });

  await check('mobile width (375 px): 16:9 stage, controls fit, no horizontal overflow', () => {
    const box = document.createElement('div');
    box.style.cssText = 'width:375px;position:absolute;left:0;top:0;visibility:hidden';
    document.body.appendChild(box);
    const mp = createMoviePlayer(box, { film, reducedMotion: false });
    const r = mp.element;
    const sr = mp.stage.getBoundingClientRect();
    assert(Math.abs(sr.width / sr.height - film.width / film.height) < 0.02, `stage ratio ${(sr.width / sr.height).toFixed(3)}`);
    assert(r.scrollWidth <= r.clientWidth + 1, `horizontal overflow: ${r.scrollWidth} > ${r.clientWidth}`);
    const btns = [...r.querySelectorAll('.mm-btn')];
    assert(btns.length >= 5 && btns.every((b) => b.getBoundingClientRect().width >= 36 && b.getBoundingClientRect().height >= 36), 'touch targets < 36 px');
    const cr = r.querySelector('.mm-controls').getBoundingClientRect();
    assert(cr.right <= 376 && cr.left >= -1, 'controls overflow the width');
    mp.destroy();
    box.remove();
    return `controls ${Math.round(cr.width)} x ${Math.round(cr.height)} px`;
  });

  console.warn = realWarn;
  return { film: filmId, ok: results.every((r) => r.ok), results, ms: Math.round(performance.now() - t0) };
}
