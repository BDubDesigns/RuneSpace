/**
 * Acting helpers: small authoring layer on top of the timeline's raw cues.
 *
 * A Track remembers the current pose of one SVG group (x, y, rot, sx, sy, flip),
 * so scene code can say "move to x=600 over 900ms" and the helper fills in the
 * "from" keyframe. Poses are absolute; cues are emitted into the shared cue list.
 *
 * Pivot: every tracked group animates around its local origin (0,0). Rigs are
 * drawn so that origin is a meaningful pivot (feet, shoulder, neck, hip...).
 */

export class Track {
  constructor(cues, target, pose = {}) {
    this.cues = cues;
    this.target = target;
    this.p = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, flip: 1, ...pose };
  }

  static tf(p) {
    return `translate(${r(p.x)}px, ${r(p.y)}px) rotate(${r(p.rot)}deg) scale(${r(p.sx * p.flip)}, ${r(p.sy)})`;
  }

  /** Inline style for the first frame (so the element is posed before any cue runs). */
  get css() {
    return `transform:${Track.tf(this.p)}`;
  }

  /**
   * Multi-keyframe move. frames: [{ o: 0..1, ...patch, ease? }, ...], the last must have o: 1.
   * Patches are cumulative. `ease` on a frame shapes the segment that leads INTO that frame;
   * opts.seg is the default for every segment (e.g. 'ease-in-out' for oscillations).
   * opts: { ease (whole cue), seg, iterations, reduce }.
   */
  keys(at, dur, frames, opts = {}) {
    let cur = { ...this.p };
    const keyframes = [{ offset: 0, transform: Track.tf(cur) }];
    for (const f of frames) {
      const { o, ease, ...patch } = f;
      cur = { ...cur, ...patch };
      const seg = ease || opts.seg;
      if (seg) keyframes[keyframes.length - 1].easing = seg;
      keyframes.push({ offset: o, transform: Track.tf(cur) });
    }
    this.cues.push({
      at,
      dur,
      target: this.target,
      keyframes,
      easing: opts.ease || (opts.seg || frames.some((f) => f.ease) ? 'linear' : 'ease-in-out'),
      iterations: opts.iterations,
      reduce: opts.reduce,
    });
    this.p = cur;
    return this;
  }

  to(at, dur, patch, opts) {
    return this.keys(at, dur, [{ o: 1, ...patch }], opts);
  }

  /** Instantly change pose at `at`. */
  set(at, patch) {
    return this.to(at, 1, patch, { ease: 'linear' });
  }

  /** Evenly spaced pattern: values is an array of patches, played across `dur`. */
  pattern(at, dur, values, opts) {
    const n = values.length;
    return this.keys(
      at,
      dur,
      values.map((v, i) => ({ o: (i + 1) / n, ...v })),
      opts
    );
  }

  /** Hop / arc: goes up by `h` and lands at patch.x / patch.y (default: where it started). */
  hop(at, dur, h, patch = {}, opts) {
    const x0 = this.p.x;
    const y0 = this.p.y;
    const { x = x0, y = y0 } = patch;
    return this.keys(
      at,
      dur,
      [
        { o: 0.5, x: (x0 + x) / 2, y: Math.min(y0, y) - h, ease: 'cubic-bezier(.15,.6,.4,1)' },
        { o: 1, ...patch, x, y, ease: 'cubic-bezier(.55,0,.9,.6)' },
      ],
      opts
    );
  }
}

/** Tween any other property of a target (opacity, visibility, ...). */
export function tween(cues, target, at, dur, from, to, opts = {}) {
  cues.push({ at, dur, target, keyframes: [from, to], easing: opts.ease || 'linear', reduce: opts.reduce, iterations: opts.iterations });
}

/** Step a group's opacity at an instant (appear / vanish). */
export function show(cues, target, at, on = true) {
  cues.push({ at, dur: 1, target, keyframes: [{ opacity: on ? 0 : 1 }, { opacity: on ? 1 : 0 }], easing: 'linear' });
}

const r = (n) => Math.round(n * 100) / 100;
