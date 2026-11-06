// Guards the three owner-approved pre-roll commercials for the Holo Drive-In (issue #491, Stage D) the way
// film1-approved.test.mjs and film2-approved.test.mjs guard the two films. The project owner gave final creative
// approval to all three on November 6, 2026, one at a time: "DeWHAT?" (with the question mark), "Visit Skatboll!"
// and "FedHex". The expected values were recorded from the build output of the approved tree (sha256 of the JSON,
// first 16 hex characters); the commercials' own sources and the shared engine, rig, art and fx must reproduce
// them byte for byte.
//
// If this fails after you touched src/ (or the artwork files below), you changed an approved spot's picture,
// timing, lettering or scene descriptions: either undo it or, if the change is intended and the owner has
// re-approved that spot, update the hashes in the same commit and say so.
//
// The artwork is RuneSpace's own and is served by the host app from public/, so it is pinned only when this
// folder sits inside a RuneSpace checkout (a packed copy of the studio has no public/ folder).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadFilm } from '../src/films/index.js';

const h = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

const APPROVED = {
  'commercial-dewhat': { scenes: 4, markup: 'c59587f0925e106d', cues: 'b5ae137e3e7fc7a8', chapters: '3b58d24099810137', sceneList: '134d372c1aaea9df' },
  'commercial-visit-skatboll': { scenes: 4, markup: 'abd483cf96350208', cues: '1560c394022e503c', chapters: '87134be7fd3f5f8d', sceneList: '31e4adff005d5e27' },
  'commercial-fedhex': { scenes: 7, markup: '8d13d86164cae7d7', cues: '693abfb0263ac214', chapters: '1e9ff7102e6735e2', sceneList: 'a8c8c1bdbd988099' },
};

for (const [id, want] of Object.entries(APPROVED)) {
  test(`${id} builds exactly as approved (markup, cues, chapters, scenes, 15 000 ms)`, async () => {
    const b = (await loadFilm(id)).build();
    assert.equal(b.duration, 15000);
    assert.equal(b.scenes.length, want.scenes);
    assert.equal(h(b.markup), want.markup, 'markup changed');
    assert.equal(h(b.cues), want.cues, 'cues changed');
    assert.equal(h(b.chapters), want.chapters, 'chapters changed');
    assert.equal(h(b.scenes), want.sceneList, 'scene list or scene descriptions changed');
  });

  test(`${id} is deterministic: two builds are identical`, async () => {
    const film = await loadFilm(id);
    assert.equal(h(film.build().markup), h(film.build().markup));
    assert.equal(h(film.build().cues), h(film.build().cues));
  });
}

// The approved artwork: the owner's real FedHex logo, its black-and-white "e" cut from that logo, and the game's own
// 4:1 location pictures the spots pan over.
const ART = {
  '/branding/fedhex-logo.webp': 'addd0785229bf462',
  '/branding/fedhex-e.webp': '58359dc8e7657953',
  '/location-scenes/fedhex-parcel-hub.webp': 'e6162d80614d4165',
  '/location-scenes/rusk-recovery.webp': '1fc43293eece6e8c',
  '/location-scenes/processing-yard.webp': 'e960a8f9bad08cca',
  '/location-scenes/hh-bnb-exterior.webp': '546187a9a786402f',
  '/location-scenes/holo-drive-in.webp': '3ef1de4ad97afa31',
};
const publicDir = fileURLToPath(new URL('../../../public', import.meta.url));

test('the approved commercial artwork files are unchanged', { skip: !existsSync(publicDir) && 'no RuneSpace public/ folder next to this studio' }, () => {
  for (const [src, want] of Object.entries(ART)) {
    const got = createHash('sha256').update(readFileSync(join(publicDir, src))).digest('hex').slice(0, 16);
    assert.equal(got, want, `${src} changed`);
  }
});

test('every image the three spots draw is a pinned approved file', async () => {
  const used = new Set();
  for (const id of Object.keys(APPROVED)) for (const a of (await loadFilm(id)).assets) used.add(a);
  assert.deepEqual([...used].sort(), Object.keys(ART).sort());
});
