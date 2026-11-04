// Structural checks run against EVERY registered film (src/films/index.js), so a new film is
// covered the moment it is registered. No browser needed: films build to plain markup + cues.
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { FILMS, loadFilm, listFilms } from '../src/films/index.js';

// Cues that are known to start outside their own scene in an APPROVED film. They are left alone
// on purpose (changing them would change the approved picture) but new films get no exceptions.
// Both are idle() breathing sways that were given scene-relative 0 instead of at(0), so they play
// during the opening card instead of the scene. See NEXT_FILM_HANDOFF.md "Known issues".
const KNOWN_OUT_OF_SCENE = {
  'that-mines-mine': new Set(['s-rival.pip.bob@0', 's-finale.rex.bob@0']),
};

// Films whose Track cues overlap on one element in places. "That Mines Mine!" is approved as it is, so it is left alone;
// new films get no exceptions (see MOVIE_AUTHORING_GUIDE.md section 11).
const OVERLAPS_ALLOWED = new Set(['that-mines-mine']);

const dataTargets = (markup) => new Set([...markup.matchAll(/data-t="([^"]+)"/g)].map((m) => m[1]));

test('registry: ids are unique and non-empty', () => {
  const ids = FILMS.map((f) => f.id);
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, ids.length, `duplicate film ids: ${ids}`);
  assert.ok(listFilms().length >= 1, 'at least one visible film');
  assert.ok(listFilms({ includeHidden: true }).length === FILMS.length);
});

test('registry: loadFilm rejects an unknown id with a helpful message', async () => {
  await assert.rejects(() => loadFilm('nope'), /Unknown film "nope"\. Registered: /);
});

for (const entry of FILMS) {
  test(`film "${entry.id}"`, async (t) => {
    const film = await loadFilm(entry.id);
    const built = film.build();

    await t.test('metadata matches the registry and is sane', () => {
      assert.equal(film.id, entry.id, 'film.id must equal its registry id');
      assert.equal(film.title, entry.title, 'film.title must equal its registry title');
      assert.ok(film.width > 0 && film.height > 0);
      assert.ok(Number.isFinite(film.posterAt) && film.posterAt >= 0 && film.posterAt < built.duration, 'posterAt inside the film');
      assert.ok(built.duration > 0);
    });

    await t.test('build() is deterministic (same markup and cues every time)', () => {
      const again = film.build();
      assert.equal(again.markup, built.markup);
      assert.deepEqual(again.cues, built.cues);
      assert.equal(again.duration, built.duration);
    });

    await t.test('scenes are contiguous, positive-length, uniquely named and captioned', () => {
      assert.ok(built.scenes.length > 0);
      let t0 = 0;
      const seen = new Set();
      for (const s of built.scenes) {
        assert.equal(s.start, t0, `scene ${s.id} starts where the previous one ended`);
        assert.ok(s.end > s.start, `scene ${s.id} has positive duration`);
        assert.ok(!seen.has(s.id), `duplicate scene id ${s.id}`);
        assert.ok(typeof s.caption === 'string' && s.caption.trim().length > 0, `scene ${s.id} needs a CAPTION entry (accessibility)`);
        seen.add(s.id);
        t0 = s.end;
      }
      assert.equal(t0, built.duration, 'duration is the sum of scene durations');
    });

    await t.test('chapters point at real scenes, in order', () => {
      const starts = new Set(built.scenes.map((s) => s.start));
      let prev = -1;
      for (const c of built.chapters) {
        assert.ok(starts.has(c.at), `chapter ${c.id} must name an existing scene id (got at=${c.at})`);
        assert.ok(c.at >= prev, `chapter ${c.id} is out of order`);
        prev = c.at;
      }
    });

    await t.test('every cue is well-formed and inside the film', () => {
      for (const c of built.cues) {
        const who = `cue on "${c.target}" at ${c.at}`;
        assert.ok(typeof c.target === 'string' && c.target, `${who}: target`);
        assert.ok(Number.isFinite(c.at) && c.at >= 0, `${who}: at must be a finite ms >= 0 (did you forget at()?)`);
        assert.ok(Number.isFinite(c.dur) && c.dur > 0, `${who}: dur must be > 0`);
        assert.ok(Array.isArray(c.keyframes) && c.keyframes.length >= 2, `${who}: needs at least 2 keyframes`);
        const end = c.at + c.dur * (c.iterations || 1);
        assert.ok(end <= built.duration + 1, `${who}: ends at ${end}, after the film (${built.duration})`);
      }
    });

    await t.test('every cue target exists in the markup (a typo here silently does nothing at runtime)', () => {
      const names = dataTargets(built.markup);
      const missing = [...new Set(built.cues.map((c) => c.target))].filter((x) => x !== 'frame' && !names.has(x));
      assert.deepEqual(missing, [], `cue targets with no data-t element: ${missing.slice(0, 8)}`);
    });

    await t.test('every url(#id) reference resolves (include FX_DEFS in the film defs)', () => {
      const ids = new Set([...built.markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      const refs = [...new Set([...built.markup.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]))];
      const unresolved = refs.filter((r) => !ids.has(r));
      assert.deepEqual(unresolved, [], `unresolved gradient/pattern refs: ${unresolved}`);
    });

    await t.test('data-t names are not shared between two scenes (prefix them with ctx.id)', () => {
      const shots = built.markup.split('<g class="mm-shot"').slice(1);
      const owner = new Map();
      const clashes = new Set();
      shots.forEach((s, i) => {
        for (const m of s.matchAll(/data-t="([^"]+)"/g)) {
          if (owner.has(m[1]) && owner.get(m[1]) !== i) clashes.add(m[1]);
          owner.set(m[1], i);
        }
      });
      assert.deepEqual([...clashes], [], `names reused across scenes: ${[...clashes].slice(0, 8)}`);
    });

    await t.test('every cue starts inside the scene that owns its target (forgot at()? idle() takes absolute ms)', () => {
      const shots = built.markup.split('<g class="mm-shot"').slice(1);
      const owner = new Map();
      shots.forEach((s, i) => {
        for (const m of s.matchAll(/data-t="([^"]+)"/g)) owner.set(m[1], i);
      });
      const allowed = KNOWN_OUT_OF_SCENE[entry.id] || new Set();
      const SLACK = 250; // a cue may start a hair past its scene's end (e.g. a face swap queued for the cut)
      const stray = [];
      for (const c of built.cues) {
        if (c.target === 'frame') continue;
        const sc = built.scenes[owner.get(c.target)];
        if (!sc) continue;
        if ((c.at < sc.start || c.at > sc.end + SLACK) && !allowed.has(`${c.target}@${c.at}`)) {
          stray.push(`${c.target} at ${c.at} (scene ${sc.id} runs ${sc.start}-${sc.end})`);
        }
      }
      assert.deepEqual(stray, [], `cues outside their scene; wrap scene-relative times in ctx.at():\n  ${stray.slice(0, 6).join('\n  ')}`);
    });

    await t.test('no two cues overlap on the same element property (a Track starts every cue from the previous cue\'s END pose, so an overlap makes the picture jump)', (tt) => {
      if (OVERLAPS_ALLOWED.has(entry.id)) return tt.skip('approved film: see OVERLAPS_ALLOWED');
      const by = new Map();
      built.cues.forEach((c, i) => {
        if (c.target === 'frame') return;
        const props = new Set();
        c.keyframes.forEach((k) => Object.keys(k).forEach((p) => !['offset', 'easing', 'composite'].includes(p) && props.add(p)));
        for (const p of props) {
          const key = `${c.target}|${p}`;
          if (!by.has(key)) by.set(key, []);
          by.get(key).push({ at: c.at, end: c.at + c.dur * (c.iterations || 1), i });
        }
      });
      const clashes = [];
      for (const [key, arr] of by) {
        arr.sort((a, b) => a.at - b.at || a.i - b.i);
        for (let k = 1; k < arr.length; k++) if (arr[k].at < arr[k - 1].end - 2) clashes.push(`${key} [${arr[k - 1].at}-${arr[k - 1].end}] vs [${arr[k].at}-${arr[k].end}]`);
      }
      assert.deepEqual(clashes.slice(0, 6), [], `${clashes.length} overlapping cues on one element property (sequence them, or move one to another Track such as torso / head)`);
    });

    await t.test('the shell has the frame transition targets the player provides', () => {
      assert.ok(built.cues.some((c) => c.target === 'frame'));
    });
  });
}
