// Render still frames of a film in headless Chrome (no npm dependencies). Playback is a pure function of time,
// so this seeks and screenshots; use it to LOOK at a scene (tests cannot tell you whether a gag is funny).
//
//   node dev/shoot.mjs <film-id> <out-prefix> <time> [<time> ...]
//   node dev/shoot.mjs <film-id> <out-prefix> every:1000        # a frame every second across the WHOLE film (visual QA)
//
// A <time> is film milliseconds ("41000") or a scene id plus an offset ("s-kick+2100", "c-ifIcant+2500").
// `every:<ms>` samples the middle of each interval (every:1000 -> 500, 1500, 2500 ...), as the review workflow in
// MOVIE_AUTHORING_GUIDE.md section 9.5 does.
// Writes <out-prefix>-00.png, -01.png, ... and, for several frames, a contact sheet <out-prefix>-sheet.png
// (needs ImageMagick's `montage`; skipped quietly if it is not installed).
//
//   COLS=3       contact-sheet columns (default 2)        W=1280 H=720   frame size
//   REDUCED=1    render in reduced-motion mode            CHROME_BIN=...  which Chrome to use
//   STAMP=1      burn "m:ss.s scene-id" into the corner of every frame (use it for reviews: sheet labels made by ImageMagick
//                can come out blank when no font is installed, a stamp cannot)
//   SHEETS=4     split the frames into this many consecutive contact sheets <out-prefix>-sheet-1.png ... (default: one)
//   SETTLE=250   ms to wait after each seek before the screenshot
//   UI=1         shoot the whole demo page (picker, chapter buttons, control bar) instead of just the picture;
//                combine with W=375 H=812 to check the phone layout
//
// Requires Node >= 22 and Chrome/Chromium, like `npm run verify`.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startServer } from './serve.mjs';

const [film, prefix, ...argTimes] = process.argv.slice(2);
let times = argTimes;
if (!film || !prefix || !times.length) {
  console.error('usage: node dev/shoot.mjs <film-id> <out-prefix> <time|scene+offset|every:ms> [...]');
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
const chrome = spawn(findChrome(), [...(process.env.VERIFY_NO_SANDBOX || process.getuid?.() === 0 ? ['--no-sandbox'] : []), '--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio', `--user-data-dir=${profile}`, '--remote-debugging-port=0', `--window-size=${W},${H}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
const every = times.length === 1 && /^every:(\d+)$/.exec(times[0]);
if (every) {
  const step = Number(every[1]);
  const dur = Number(await run('window.__film.duration'));
  times = [];
  for (let t = step / 2; t < dur; t += step) times.push(String(Math.round(t)));
}
const SETTLE = Number(process.env.SETTLE || 250);
const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(((ms % 60000) / 1000).toFixed(1)).padStart(4, '0')}`;

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
  if (process.env.STAMP === '1') {
    const sc = scenes.find((s) => ms >= s.start && ms < s.end) || scenes[scenes.length - 1];
    await run(`(() => { let e = document.getElementById('__stamp'); if (!e) { e = document.createElement('div'); e.id = '__stamp'; e.style.cssText = 'position:fixed;left:6px;top:6px;z-index:99999;padding:2px 8px;background:#000;color:#fff;font:bold ${Math.round(H / 14)}px monospace;opacity:.85;pointer-events:none'; document.body.appendChild(e); } e.textContent = ${JSON.stringify(`${fmt(ms)}  ${sc.id}`)}; })()`);
  }
  await sleep(SETTLE);
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
    const sheets = Math.max(1, Number(process.env.SHEETS || 1));
    const per = Math.ceil(files.length / sheets);
    for (let k = 0; k < sheets; k++) {
      const chunk = files.slice(k * per, (k + 1) * per);
      if (!chunk.length) break;
      const out = sheets === 1 ? `${prefix}-sheet.png` : `${prefix}-sheet-${k + 1}.png`;
      execFileSync('montage', [...chunk.flatMap(([f, t]) => ['-label', t, f]), '-tile', `${cols}x`, '-geometry', `${Math.round(1280 / cols)}x${Math.round((H * 1280) / W / cols)}+4+4`, '-background', '#222', '-fill', 'white', out]);
      console.log(out, `${chunk.length} frames, ${chunk[0][1]} .. ${chunk[chunk.length - 1][1]}`);
    }
  } catch {
    console.log('(ImageMagick `montage` not available: no contact sheet)');
  }
}
process.exit(0);
