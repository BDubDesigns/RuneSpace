// Keeps the written docs honest: every repo path and `npm run` script they mention must exist,
// so a rename can't silently leave a fresh agent following stale instructions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
// Paths of films that are planned but intentionally not created yet (the docs tell the next agent to create them).
const PLANNED = [/rare-or-weld-done/];
const DOCS = ['README.md', 'MOVIE_AUTHORING_GUIDE.md', 'NEXT_FILM_HANDOFF.md'];
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;

for (const doc of DOCS) {
  test(`${doc} exists`, () => assert.ok(existsSync(join(root, doc)), `${doc} is missing`));
  if (!existsSync(join(root, doc))) continue;
  const text = readFileSync(join(root, doc), 'utf8');

  test(`${doc}: every named repo path exists`, () => {
    const missing = [];
    for (const m of text.matchAll(/`((?:src|dev|test)\/[^`\s]+)`/g)) {
      const raw = m[1].replace(/[.,:;)]+$/, '').replace(/:\d+$/, '');
      if (/[<>*{}…]/.test(raw)) continue; // templates like src/films/<id>/
      if (PLANNED.some((re) => re.test(raw))) continue;
      if (!existsSync(join(root, raw))) missing.push(raw);
    }
    assert.deepEqual([...new Set(missing)], [], `paths named in ${doc} that do not exist`);
  });

  test(`${doc}: every "npm run <script>" exists in package.json`, () => {
    const bad = [];
    for (const m of text.matchAll(/npm run ([\w:-]+)/g)) if (!(m[1] in scripts)) bad.push(m[1]);
    assert.deepEqual([...new Set(bad)], [], `unknown npm scripts in ${doc}`);
  });
}
