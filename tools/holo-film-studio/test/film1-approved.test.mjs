// Guards the approved first film against changes to the shared engine, rig, art and fx. The expected hashes were
// recorded from the build output of the `film1-approved` git tag (sha256 of the JSON, first 16 hex characters).
// If this fails after you touched src/, you changed the approved picture or timing: either undo it or, if the
// change is intended and the owner has re-approved the film, update the hashes in the same commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import film from '../src/films/that-mines-mine/index.js';

const h = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

test('"That Mines Mine!" builds exactly as approved (markup, cues, chapters, duration)', () => {
  const b = film.build();
  assert.equal(b.duration, 103400);
  assert.equal(h(b.markup), 'd2ce8eaa1ae8a6d6', 'markup changed');
  assert.equal(h(b.cues), '3c2332c3c862e9cc', 'cues changed');
  assert.equal(h(b.chapters), 'bcc616fbe97ca9d3', 'chapters changed');
});
