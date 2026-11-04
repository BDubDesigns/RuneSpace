/**
 * Film assembly: turns a declarative film definition into
 *   { markup, cues, duration, scenes, chapters }
 * which the player feeds to createTimeline().
 *
 * A film definition is plain data plus scene builder functions:
 *
 *   defineFilm({
 *     id, title, width, height, posterAt,
 *     defs: '<linearGradient .../>',              // shared SVG <defs> content
 *     chapters: [{ id, label, scene }],           // jump points (the story beats)
 *     scenes: [{
 *       id, label, duration, caption,
 *       in: 'cut' | 'iris' | 'fade',  out: 'cut' | 'iris' | 'fade',   // inMs / outMs: transition length
 *       irisIn: [50, 50], irisOut: [50, 50],      // iris centre, % of frame
 *       build(ctx) { ctx.cues.push(...); return '<g>svg markup</g>'; },
 *     }],
 *   });
 *
 * `ctx.at(rel)` converts scene-relative ms to absolute film ms, so a scene can
 * be written as "0 .. duration" and re-ordered or re-timed freely.
 */

export const TRANSITION_MS = 520;
const OPEN = 'circle(75% at 50% 50%)';
const iris = (r, [x, y] = [50, 50]) => `circle(${r}% at ${x}% ${y}%)`;

export function defineFilm(def) {
  const width = def.width || 1280;
  const height = def.height || 720;

  function build() {
    const cues = [];
    const scenes = [];
    let markup = '';
    let t = 0;
    let closed = false; // iris state of the frame
    let faded = false; // fade state of the frame

    const frame = (cue) => cues.push({ target: 'frame', reduce: 'snap', ...cue });
    // Resting state, so a later first transition never back-fills "closed" over earlier scenes.
    frame({ at: 0, dur: 1, keyframes: [{ clipPath: OPEN }, { clipPath: OPEN }] });
    frame({ at: 0, dur: 1, keyframes: [{ opacity: 1 }, { opacity: 1 }] });

    def.scenes.forEach((scene, index) => {
      const t0 = t;
      const isLast = index === def.scenes.length - 1;
      const dur = scene.duration;
      const mode = { in: scene.in || 'cut', out: scene.out || 'cut' };
      const tIn = scene.inMs ?? TRANSITION_MS;
      const tOut = scene.outMs ?? TRANSITION_MS;

      const ctx = {
        id: scene.id,
        t0,
        dur,
        width,
        height,
        cues,
        at: (rel) => t0 + rel,
      };
      const inner = scene.build(ctx);
      markup += `<g class="mm-shot" data-t="${scene.id}">${inner}</g>`;
      cues.push({
        at: t0,
        dur,
        target: scene.id,
        keyframes: [{ visibility: 'visible' }, { visibility: 'visible' }],
        fill: isLast ? 'forwards' : 'none', // the last shot stays up at t = duration
      });

      // --- transition in
      if (mode.in === 'iris') {
        if (faded) frame({ at: t0, dur: 1, keyframes: [{ opacity: 0 }, { opacity: 1 }] });
        faded = false;
        const c = scene.irisIn;
        frame({
          at: t0,
          dur: tIn,
          easing: 'cubic-bezier(.3,.7,.3,1)',
          keyframes: [{ clipPath: iris(0, c) }, { clipPath: OPEN }],
        });
        closed = false;
      } else if (mode.in === 'fade') {
        if (closed) frame({ at: t0, dur: 1, keyframes: [{ clipPath: iris(0) }, { clipPath: OPEN }] });
        closed = false;
        frame({ at: t0, dur: tIn, keyframes: [{ opacity: 0 }, { opacity: 1 }] });
        faded = false;
      } else {
        if (closed) frame({ at: t0, dur: 1, keyframes: [{ clipPath: iris(0) }, { clipPath: OPEN }] });
        if (faded) frame({ at: t0, dur: 1, keyframes: [{ opacity: 0 }, { opacity: 1 }] });
        closed = faded = false;
      }

      // --- transition out
      if (mode.out === 'iris') {
        frame({
          at: t0 + dur - tOut,
          dur: tOut,
          easing: 'cubic-bezier(.6,0,.7,.3)',
          keyframes: [{ clipPath: OPEN }, { clipPath: iris(0, scene.irisOut) }],
        });
        closed = true;
      } else if (mode.out === 'fade') {
        frame({
          at: t0 + dur - tOut,
          dur: tOut,
          keyframes: [{ opacity: 1 }, { opacity: 0 }],
        });
        faded = true;
      }

      scenes.push({
        id: scene.id,
        label: scene.label || scene.id,
        caption: scene.caption || '',
        start: t0,
        end: t0 + dur,
      });
      t += dur;
    });

    const chapters = (def.chapters || []).map((c) => {
      const s = scenes.find((x) => x.id === c.scene);
      return { id: c.id, label: c.label, at: s ? s.start : 0 };
    });

    return {
      markup: `<defs>${def.defs || ''}</defs>${markup}`,
      cues,
      duration: t,
      scenes,
      chapters,
    };
  }

  return { id: def.id, title: def.title, width, height, posterAt: def.posterAt || 0, build };
}
