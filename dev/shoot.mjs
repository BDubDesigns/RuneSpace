// Render still frames of a film in headless Chrome (no npm dependencies). Playback is a pure function of time,
// so this seeks and screenshots; use it to LOOK at a scene (tests cannot tell you whether a gag is funny).
//
//   node dev/shoot.mjs <film-id> <out-prefix> <time> [<time> ...]
//
// A <time> is film milliseconds ("41000") or a scene id plus an offset ("s-kick+2100", "c-ifIcant+2500").
// Writes <out-prefix>-00.png, -01.png, ... and, for several frames, a contact sheet <out-prefix>-sheet.png
// (needs ImageMagick's `montage`; skipped quietly if it is not installed).
//
//   COLS=3       contact-sheet columns (default 2)        W=1280 H=720   frame size
//   REDUCED=1    render in reduced-motion mode            CHROME_BIN=...  which Chrome to use
//   UI=1         shoot the whole demo page (picker, chapter buttons, control bar) instead of just the picture;
//                combine with W=375 H=812 to check the phone layout
//
// Requires Node >= 22 and Chrome/Chromium, like `npm run verify`.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startServer } from './serve.mjs';

const [film, prefix, ...times] = process.argv.slice(2);
if (!film || !prefix || !times.length) {
  console.error('usage: node dev/shoot.mjs <film-id> <out-prefix> <time|scene+offset> [...]');
  process.exit(2);
}
const W = Number(process.env.W || 1280);
const H = Number(process.env.H || 720);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const dir of (process.env.PATH || '').split(':')) {
    for (const n of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'chrome']) if (existsSync(join(dir, n))) return join(dir, n);
  }
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(mac)) return mac;
  throw new Error('No Chrome/Chromium found. Set CHROME_BIN=/path/to/chrome');
}

const { server, port } = await startServer(0);
const profile = mkdtempSync(join(tmpdir(), 'mm-shoot-'));
const chrome = spawn(findChrome(), ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio', `--user-data-dir=${profile}`, '--remote-debugging-port=0', `--window-size=${W},${H}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let wsUrl = '';
await new Promise((res) => chrome.stderr.on('data', (d) => { const m = /ws:\/\/\S+/.exec(String(d)); if (m && !wsUrl) { wsUrl = m[0]; res(); } }));
const tabs = await (await fetch(wsUrl.replace(/\/devtools\/.*/, '').replace('ws://', 'http://') + '/json')).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${port}/?film=${film}${process.env.UI === '1' ? '' : '&ui=0&bare=1'}${process.env.REDUCED === '1' ? '&reduced=1' : ''}` });
await sleep(1200);
await run('window.__filmReady');
const scenes = JSON.parse(await run('JSON.stringify(window.__film.scenes)'));

mkdirSync(dirname(prefix), { recursive: true });
const files = [];
for (const t of times) {
  let ms = Number(t);
  if (/^[cs]-/.test(t)) {
    const [sid, off] = t.split('+');
    const sc = scenes.find((s) => s.id === sid);
    if (!sc) throw new Error(`no scene "${sid}" in ${film}`);
    ms = sc.start + Number(off || 0);
  }
  await run(`window.__film.seek(${ms})`);
  await sleep(250);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const f = `${prefix}-${String(files.length).padStart(2, '0')}.png`;
  writeFileSync(f, Buffer.from(shot.data, 'base64'));
  files.push([f, t]);
  console.log(f, t, `${ms} ms`);
}
ws.close();
chrome.kill();
server.close();
if (files.length > 1) {
  try {
    const cols = Number(process.env.COLS || 2);
    execFileSync('montage', [...files.flatMap(([f, t]) => ['-label', t, f]), '-tile', `${cols}x`, '-geometry', `${Math.round(1280 / cols)}x${Math.round((H * 1280) / W / cols)}+4+4`, '-background', '#222', '-fill', 'white', `${prefix}-sheet.png`]);
    console.log(`${prefix}-sheet.png`);
  } catch {
    console.log('(ImageMagick `montage` not available: no contact sheet)');
  }
}
process.exit(0);
