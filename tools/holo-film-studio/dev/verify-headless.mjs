// Run dev/verify.html for one or more films in headless Chrome, with no npm dependencies.
//   npm run verify                      all registered films (including the hidden template)
//   node dev/verify-headless.mjs that-mines-mine rare-or-weld-done
//   CHROME_BIN=/path/to/chrome npm run verify
// Exit code 0 = every check passed. Requires Node >= 22 (global WebSocket) and a Chrome/Chromium.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './serve.mjs';
import { FILMS } from '../src/films/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const env = process.env.CHROME_BIN;
  if (env) return env;
  const names = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'chrome'];
  for (const dir of (process.env.PATH || '').split(':')) for (const n of names) if (existsSync(join(dir, n))) return join(dir, n);
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(mac)) return mac;
  const pw = join(homedir(), '.cache', 'ms-playwright'); // Playwright's bundled Chromium, if present
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) if (existsSync(join(pw, d, sub))) return join(pw, d, sub);
    }
  }
  throw new Error('No Chrome/Chromium found. Set CHROME_BIN=/path/to/chrome');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('DevTools websocket failed'));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : FILMS.map((f) => f.id);
const { server, port } = await startServer(0);
const profile = mkdtempSync(join(tmpdir(), 'mm-verify-'));
const chrome = spawn(findChrome(), [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1280,900',
  ...(process.env.VERIFY_NO_SANDBOX || process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });

let failed = 0;
try {
  let debugPort;
  for (let i = 0; i < 100 && !debugPort; i++) {
    await sleep(100);
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) debugPort = readFileSync(f, 'utf8').split('\n')[0];
  }
  if (!debugPort) throw new Error('Chrome did not start (no DevToolsActivePort)');
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const client = cdp(page.webSocketDebuggerUrl);
  await client.ready;

  for (const id of ids) {
    await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/dev/verify.html?film=${encodeURIComponent(id)}` });
    let res = null;
    const t0 = Date.now();
    while (!res && Date.now() - t0 < 180000) {
      await sleep(500);
      const r = await client.send('Runtime.evaluate', { expression: 'JSON.stringify(window.__verify || null)', returnByValue: true });
      res = JSON.parse(r.result.value || 'null');
    }
    if (!res) {
      console.log(`\n${id}: TIMED OUT (no result after 180 s)`);
      failed++;
      continue;
    }
    console.log(`\n${id}: ${res.ok ? 'PASS' : 'FAIL'}  (${res.ms} ms)`);
    for (const r of res.results) console.log(`  ${r.ok ? '✔' : '✘'} ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
    if (!res.ok) failed++;
  }
  client.close();
} finally {
  chrome.kill();
  server.close();
  await sleep(200);
  rmSync(profile, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} film(s) FAILED` : '\nAll films passed.');
process.exit(failed ? 1 : 0);
