// Checks specific to the three 15-second pre-roll commercials for the Holo Drive-In (issue #491, Stage D):
// "DeWHAT", "Visit Skatboll!" and "FedHex". Structural checks for every film (cues in range, captions,
// determinism, no overlapping cues) are in films.test.mjs and cover them automatically.
//
// These keep each spot on its owner-approved script and its exact length. Whether a gag is funny or legible is
// judged by eye (guide section 9.5), and each spot needs the owner's individual approval before it ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { FILMS, loadFilm } from '../src/films/index.js';

const COMMERCIALS = FILMS.filter((f) => f.kind === 'commercial');
const dir = (id) => fileURLToPath(new URL(`../src/films/${id}/`, import.meta.url));
const sources = (id) =>
  readdirSync(dir(id), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'))
    .join('\n');
const shown = (markup) => [...markup.matchAll(/>([^<>]+)</g)].map((m) => m[1]).join(' ');

test('the three commercials are registered, by id, as commercials', () => {
  assert.deepEqual(
    COMMERCIALS.map((f) => [f.id, f.title]),
    [
      ['commercial-dewhat', 'DeWHAT'],
      ['commercial-visit-skatboll', 'Visit Skatboll!'],
      ['commercial-fedhex', 'FedHex'],
    ]
  );
});

for (const entry of COMMERCIALS) {
  test(`"${entry.title}" is exactly 15 seconds, silent, and its art exists`, async () => {
    const film = await loadFilm(entry.id);
    const built = film.build();
    assert.equal(built.duration, 15000, 'a pre-roll commercial is exactly 15 000 ms');
    assert.ok(built.scenes.every((s) => s.caption.trim().length > 20), 'every scene has a real scene description');
    assert.ok(!/\bAudio\b|AudioContext|<audio|<video|\.mp3|\.ogg|\.wav|speechSynthesis/.test(sources(entry.id)), 'silent: no audio anywhere');
    // Every image the markup draws is declared in film.assets (so a host can preload it), and nothing else is.
    const drawn = [...new Set([...built.markup.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))].sort();
    assert.deepEqual(drawn, [...film.assets].sort());
    // The art is RuneSpace's own, served by the host app: in a checkout it is in public/.
    const publicDir = fileURLToPath(new URL('../../../public', import.meta.url));
    if (existsSync(publicDir)) {
      for (const a of film.assets) assert.ok(existsSync(join(publicDir, a)), `${a} exists in the app's public/ folder`);
    }
  });
}

test('"DeWHAT" keeps the approved argument, its consistent capitals and its slogan', async () => {
  const { TEXT } = await import('../src/films/commercial-dewhat/config.js');
  assert.equal(TEXT.opening.join(' '), "Power's out! What do we do?!");
  assert.deepEqual(
    TEXT.lines.map((l) => [l.who, l.lines.join(' ')]),
    [
      [2, 'DeWhat.'],
      [1, "That's what I'm asking! Do what?!"],
      [2, 'No, DeWHAT!'],
      [1, 'WHAT DO WE DO?!'],
      [2, 'DeWHAT!'],
      [1, "I DON'T KNOW WHAT!"],
    ]
  );
  // The logo is DeWHAT (only the e lowercase, no question mark); talking is DeWhat, shouting is DeWHAT.
  assert.equal(`${TEXT.brand} ${TEXT.slogan.join(' ')}`, 'DeWHAT Sometimes you gotta DeWhat you wanna do™.');
  const everything = JSON.stringify([TEXT.opening, TEXT.lines, TEXT.sign, TEXT.brand, TEXT.slogan]);
  assert.ok(!/DeWh?at\?|DeWHAT\?/i.test(everything), 'no question mark after DeWHAT or DeWhat');
  assert.ok(!/DEWHAT/.test(everything), 'always DeWHAT, never DEWHAT');
  const text = shown((await loadFilm('commercial-dewhat')).build().markup);
  for (const s of ['DeWhat.', 'No, DeWHAT!', 'WHAT DO WE DO?!', 'DeWHAT!', 'DeWHAT', 'EMERGENCY POWER ANNEX', 'DeWhat you wanna do™.']) assert.ok(text.includes(s), s);
});

test('"Visit Skatboll!" pans the approved art in the approved order and ends on the approved lines', async () => {
  const { ART, TEXT, TIMING } = await import('../src/films/commercial-visit-skatboll/config.js');
  assert.deepEqual(Object.values(ART).map((a) => a.src), [
    '/location-scenes/rusk-recovery.webp',
    '/location-scenes/processing-yard.webp',
    '/location-scenes/hh-bnb-exterior.webp',
    '/location-scenes/holo-drive-in.webp',
  ]);
  assert.deepEqual(TIMING, { nightlife: 4000, scenery: 4000, hospitality: 4000, finale: 3000 });
  assert.deepEqual([TEXT.nightlife.join(' '), TEXT.scenery.join(' '), TEXT.hospitality.join(' ')], ['DAZZLING NIGHTLIFE!', 'BREATHTAKING SCENERY!', 'UNFORGETTABLE HOSPITALITY!']);
  assert.deepEqual(TEXT.finale.map((l) => l.t), ['SKATBOLL', "IT'S NOT ALL WORK."]);
  assert.equal(TEXT.stamp, 'MOSTLY WORK.');
});

test('"FedHex" keeps its beats, its one-off ending and the real logo', async () => {
  const { TEXT, TIMING } = await import('../src/films/commercial-fedhex/config.js');
  assert.equal(TEXT.matters, 'EVERY PARCEL MATTERS.');
  assert.equal(`${TEXT.brand.join('')}. ${TEXT.line.join(' ')}`, 'FedHex. We take the little things seriously.');
  const t = TIMING;
  assert.equal(t.counter, 3000);
  assert.equal(t.counter + t.boxes, 7000);
  assert.equal(t.counter + t.boxes + t.load + t.fly + t.arrive, 11000);
  assert.equal(t.counter + t.boxes + t.load + t.fly + t.arrive + t.unwrap, 13000);
  const world = readFileSync(join(dir('commercial-fedhex'), 'world.js'), 'utf8');
  assert.ok(world.includes("PURPLE = '#3d087f'") && world.includes("ORANGE = '#fc5b00'"));
  // The ident uses the owner's real logo file, not a redraw.
  const cfg = await import('../src/films/commercial-fedhex/config.js');
  assert.equal(cfg.ART.logo.src, '/branding/fedhex-logo.webp');
  assert.ok(readFileSync(join(dir('commercial-fedhex'), 'scenes/ident.js'), 'utf8').includes('ART.logo.src'));
});
