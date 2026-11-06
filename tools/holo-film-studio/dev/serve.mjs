// Tiny zero-dependency static server with no caching, for local development and for verify.
//   node dev/serve.mjs [port]      (default 5173)
// Also importable: `import { startServer } from './serve.mjs'` -> { server, port } (port 0 = any free port).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const hostPublic = fileURLToPath(new URL('../../../public', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.webp': 'image/webp', '.png': 'image/png' };

export function startServer(port = 5173) {
  const server = createServer(async (req, res) => {
    try {
      let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (p.endsWith('/')) p += 'index.html';
      let file = join(root, p);
      if (!file.startsWith(root)) throw new Error('outside root');
      // The 15-second commercials pan real RuneSpace location art, which the host app serves from
      // its own `public/` folder (for example /location-scenes/x.webp). In a RuneSpace checkout this
      // dev-only server falls back to that folder, read-only, so the spots can be previewed here.
      const exists = await stat(file).then((s) => !s.isDirectory(), () => false);
      if (!exists) {
        const hostFile = join(hostPublic, p);
        if (!hostFile.startsWith(hostPublic) || !(await stat(hostFile).then((s) => s.isFile(), () => false))) throw new Error('missing');
        file = hostFile;
      }
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { port } = await startServer(Number(process.argv[2]) || 5173);
  console.log(`http://127.0.0.1:${port}/`);
}
