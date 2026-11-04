/**
 * The attraction as a set: crater + Emerald + fence + gate (+ booth, sign), with every welded part optionally
 * animated. Used by the montage, the queue and the sign-replacement scenes.
 *
 *   const y = yard(cues, id, { posts: 'done'|'anim'|'none' (or an array of 6), runs: { fl, fr, lw, rw, bk }: same, gate: ..., day: false });
 *   y.before   background + back fence + crater + Emerald + wings (draw first)
 *   y.after    front posts + front runs + gate (draw after the Emerald, before people in front)
 *   y.post(i, t)      post i grows from its base (260 ms)            y.run(k, t, dur)   run k is welded on left to right
 *   y.gateIn(t, dur)  the gate is drawn upward                       y.swing(t, dur, open)  the leaves open / close
 *   y.pop(...) etc.: see the code.
 * Post order in YARD.posts: FL, FR, BL, BR, gate-left, gate-right.
 */
import { emerald } from '../../../art/emerald.js';
import { post, fenceRun, gate } from '../../../art/weld.js';
import { INK } from '../../../art/props.js';
import { Track } from '../../../acting.js';
import { museumFront, craterBack, craterFront, YARD, GY } from '../world.js';

const BACK_POSTS = [2, 3];
const WING_POSTS = [0, 1];
const FRONT_POSTS = [4, 5];

export function yard(cues, id, st = {}) {
  const day = !!st.day;
  const mode = (v, i) => (Array.isArray(v) ? v[i] : v) ?? 'done';
  const posts = YARD.posts.map((p, i) => {
    const m = mode(st.posts, i);
    const t = new Track(cues, `${id}.post${i}`, { x: p.x, y: p.y, sy: m === 'done' ? 1 : 0 });
    return { m, t, p, html: m === 'none' ? '' : `<g data-t="${id}.post${i}" style="${t.css}">${post(p.h)}</g>` };
  });
  const runs = {};
  for (const [k, r] of Object.entries(YARD.runs)) {
    const m = (st.runs && st.runs[k]) || 'done';
    runs[k] = {
      m,
      html: m === 'none' ? '' : `<g data-t="${id}.run${k}" ${m === 'anim' ? 'style="clip-path:inset(0 100% 0 0)"' : ''}>${fenceRun(r)}</g>`,
    };
  }
  const gm = st.gate || 'done';
  const gateY = YARD.front;
  const gw = YARD.gate.x1 - YARD.gate.x0;
  const gateHtml =
    gm === 'none'
      ? ''
      : `<g data-t="${id}.gate" ${gm === 'anim' ? 'style="clip-path:inset(100% 0 0 0)"' : ''}><g transform="translate(${YARD.cx} ${gateY})">${gate(`${id}.g`, gw, YARD.gate.h)}</g></g>`;

  const em = YARD.gem;
  const gem = `<g transform="translate(${em.x} ${em.y}) rotate(${em.tilt}) scale(${em.s})">${emerald(`${id}.em`, { w: 300, h: 360 })}</g>`;
  const cr = { x: YARD.crater.x, y: YARD.crater.y, rx: YARD.crater.rx, ry: YARD.crater.ry, day };

  const wall = museumFront(id, { hole: true, day, light: !st.noLight, cam: true });
  const before = `${wall}${runs.bk.html}${BACK_POSTS.map((i) => posts[i].html).join('')}${craterBack(id, cr)}${gem}${craterFront(id, cr)}${runs.lw.html}${runs.rw.html}${WING_POSTS.map((i) => posts[i].html).join('')}`;
  const after = `${runs.fl.html}${runs.fr.html}${FRONT_POSTS.map((i) => posts[i].html).join('')}${gateHtml}`;

  const api = {
    before,
    after,
    posts,
    /** post i grows from its base with a little overshoot */
    post(i, t, dur = 260) {
      posts[i].t.keys(t, dur, [{ o: 0.6, sy: 1.14 }, { o: 1, sy: 1 }], { ease: 'cubic-bezier(.2,.9,.3,1)', reduce: 'snap' });
    },
    /** run k is welded on, left to right */
    run(k, t, dur = 500) {
      cues.push({ at: t, dur, target: `${id}.run${k}`, easing: 'linear', keyframes: [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], reduce: 'snap' });
    },
    gateIn(t, dur = 500) {
      cues.push({ at: t, dur, target: `${id}.gate`, easing: 'ease-out', keyframes: [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)' }], reduce: 'snap' });
    },
    /** open (true) or close the leaves: they hinge at their outer edge and foreshorten */
    swing(t, dur, open) {
      const from = open ? 'scaleX(1)' : 'scaleX(0.18)';
      const to = open ? 'scaleX(0.18)' : 'scaleX(1)';
      ['L', 'R'].forEach((s) => cues.push({ at: t, dur, target: `${id}.g.${s}`, easing: 'ease-in-out', keyframes: [{ transform: from }, { transform: to }], reduce: 'snap' }));
    },
  };
  return api;
}
