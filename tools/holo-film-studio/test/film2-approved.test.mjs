// Guards the approved second film against changes to the shared engine, rig, art and fx, the way
// film1-approved.test.mjs guards the first. The owner gave final creative approval for "Rare or Weld Done?"
// on November 5, 2026; the approved ~3:01 / 37-scene version is the one the subtree import brought into
// RuneSpace as commit 62d2d0484e6101eb3fafe0a255ba1321cc9eaa88 (the import's `git-subtree-split` source is
// 9ce0ddf04bfa4cfaf421c828da47db8d5c5ba630). There is deliberately NO `film2-approved` tag: the pin below
// is the approval reference. The expected hashes were recorded from the build output of that commit's
// `tools/holo-film-studio/src` (sha256 of the JSON, first 16 hex characters), and the current tree
// reproduces them byte for byte.
//
// One owner-authorized revision since the import: the museum label "PLANET THREE MUSEUM" became "TORTUGA-9 MUSEUM"
// (Tortuga-9 is the approved name of the third planet). Only the markup and scene-description hashes changed; the
// cues, chapters, scene list, scene order and the 181,300 ms runtime are byte-identical to the original approval.
//
// If this fails after you touched src/, you changed the approved picture, timing or scene descriptions:
// either undo it or, if the change is intended and the owner has re-approved the film, update the hashes in
// the same commit and say so.
//
// To re-derive the hashes independently of the working tree:
//   git archive 62d2d04 tools/holo-film-studio/src | tar -x -C "$(mktemp -d)"   # then hash build() output there
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import film from '../src/films/rare-or-weld-done/index.js';

const h = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

test('"Rare or Weld Done?" builds exactly as approved (markup, cues, chapters, scenes, duration)', () => {
  const b = film.build();
  assert.equal(b.duration, 181300);
  assert.equal(b.scenes.length, 37);
  assert.equal(h(b.markup), '1af0b4814d2a5c85', 'markup changed');
  assert.equal(h(b.cues), '3ca2aba4a5146077', 'cues changed');
  assert.equal(h(b.chapters), '37439ce27512434a', 'chapters changed');
  assert.equal(h(b.scenes), '01ed1e0e99fab8f6', 'scene list or scene descriptions changed');
});

test('the approved build is deterministic: two builds are identical', () => {
  assert.equal(h(film.build().markup), h(film.build().markup));
  assert.equal(h(film.build().cues), h(film.build().cues));
});
