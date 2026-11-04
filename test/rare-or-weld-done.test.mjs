// Checks specific to "Rare or Weld Done?": the locked story points of the approved screenplay (STORY.md) and the
// "names live in config.js" rule. Structural checks for every film are in films.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import film from '../src/films/rare-or-weld-done/index.js';
import { NAMES, TEXT, TIMING } from '../src/films/rare-or-weld-done/config.js';

const built = film.build();
const dir = fileURLToPath(new URL('../src/films/rare-or-weld-done/', import.meta.url));
const sceneId = (id) => built.scenes.find((s) => s.id === id);

test('the locked punchline cards keep the approved wording, one after the other', () => {
  assert.deepEqual(TEXT.ifIcant, ["IF I CAN'T BRING THE EMERALD", 'TO A FENCE...']);
  assert.deepEqual(TEXT.illBring, ["I'LL BRING THE FENCE", 'TO THE EMERALD!']);
  const a = sceneId('c-ifIcant');
  const b = sceneId('c-illBring');
  assert.equal(a.end, b.start, 'the second card follows the first without a cut-away');
  assert.ok(b.end - b.start >= 4500, 'the punchline card has room to land');
});

test('the eight beats are chapters, in story order', () => {
  assert.deepEqual(
    built.chapters.map((c) => c.id),
    ['intro', 'beat1', 'beat2', 'beat3', 'beat4', 'beat5', 'beat6', 'beat7', 'beat8']
  );
});

test('the ending is the approved one: reread ONE WEEK ONLY!, weld the OPEN DAILY plate, iris closes, THE END (no explanatory card)', () => {
  const ids = built.scenes.map((s) => s.id);
  assert.deepEqual(ids.slice(-3), ['s-reread', 's-plate', 'c-end']);
  assert.equal(TEXT.weekOnly, 'ONE WEEK ONLY!');
  assert.equal(TEXT.openDaily, 'OPEN DAILY');
  assert.match(built.markup, /ONE WEEK ONLY!/);
  assert.match(built.markup, /OPEN<\/text>/);
  assert.match(built.markup, /DAILY<\/text>/);
  const cardScenes = built.scenes.filter((s) => s.id.startsWith('c-')).map((s) => s.label.toUpperCase());
  assert.ok(!cardScenes.some((l) => /COULDN'T|WELDED ONE|SO HE/.test(l)), 'no card explains the joke');
  assert.equal(cardScenes.at(-1), 'THE END');
});

test('the setup is planted: the dealer is labelled FENCE in the thought bubble and again on the far road', () => {
  const plan = built.markup.slice(built.markup.indexOf('data-t="s-plan"'), built.markup.indexOf('data-t="s-grab"'));
  assert.match(plan, />FENCE</);
  const despair = built.markup.slice(built.markup.indexOf('data-t="s-despair"'), built.markup.indexOf('data-t="c-ifIcant"'));
  assert.match(despair, />FENCE</);
});

test('no police officer, no ticket-buying cop: the cast is the thief, the dealer, the tourists and a bird', () => {
  const src = readdirSync(join(dir, 'scenes')).map((f) => readFileSync(join(dir, 'scenes', f), 'utf8')).join('\n');
  assert.ok(!/police|cop\b|officer|badge/i.test(src));
});

test('placeholder lore lives in config.js only: no scene hard-codes the Emerald\'s name, the planet, or the price', () => {
  const offenders = [];
  for (const f of ['world.js', 'index.js', ...readdirSync(join(dir, 'scenes')).map((x) => `scenes/${x}`)]) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(/NEBULA|PLANET THREE|THIRD PLANET|5 CREDITS|CREDITS ADMISSION/gi)) offenders.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(offenders, []);
  assert.match(built.markup, new RegExp(NAMES.museum), 'the museum label from config is on the wall');
  assert.match(built.markup, new RegExp(NAMES.emerald.split(' ').slice(0, -1).join(' ')), 'the headline comes from config');
});

test('runtime is on target: about 2 to 2.5 minutes, every scene has a duration and a caption', () => {
  assert.ok(built.duration >= 120000 && built.duration <= 160000, `runtime ${built.duration} ms`);
  for (const s of built.scenes) assert.ok(s.caption.trim().length > 4, `${s.id} caption`);
  assert.ok(Object.values(TIMING).every((n) => n >= 1500));
});
