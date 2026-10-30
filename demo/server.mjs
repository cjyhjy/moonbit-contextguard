import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guardJson } from '../tools/api.mjs';

const demoRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(demoRoot, '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const bodyLimit = 2 * 1024 * 1024;

function send(res, status, value, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
  res.end(type.startsWith('application/json') && typeof value !== 'string' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
}

export function createDemoServer({ guardFn = guardJson } = {}) {
  return createServer(async (req, res) => {
    try {
      const port = req.socket.localPort;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return send(res, 403, { error: 'Local host only' });
      if (req.headers.origin && ![ `http://127.0.0.1:${port}`, `http://localhost:${port}` ].includes(req.headers.origin)) return send(res, 403, { error: 'Same-origin requests only' });
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      if (pathname === '/api/guard') {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST required' });
        if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return send(res, 415, { error: 'JSON required' });
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > bodyLimit) { send(res, 413, { error: 'Request exceeds 2 MiB' }); return; }
          chunks.push(chunk);
        }
        let source;
        try { source = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
        catch { return send(res, 400, { error: 'Request must contain valid UTF-8' }); }
        // Preserve duplicate keys for the core's raw transport validation.
        try { return send(res, 200, guardFn(source)); }
        catch (error) {
          if (error instanceof TypeError) return send(res, 400, { error: error.message });
          throw error;
        }
      }
      if (pathname === '/api/health') return send(res, 200, { status: 'ok', engine: 'MoonBit core via tools/api.mjs', remote_model_calls: false });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'GET required' });
      const fixture = pathname.startsWith('/fixtures/');
      const base = fixture ? resolve(projectRoot, 'fixtures') : demoRoot;
      const relative = fixture ? pathname.slice('/fixtures/'.length) : pathname === '/' ? 'index.html' : pathname.slice(1);
      if (!relative || relative.split('/').some((s) => s.startsWith('.'))) return send(res, 404, { error: 'Not found' });
      const file = await realpath(resolve(base, relative));
      if (!file.startsWith(base + sep) || !types[extname(file)]) return send(res, 404, { error: 'Not found' });
      const content = await readFile(file);
      return send(res, 200, req.method === 'HEAD' ? '' : content, types[extname(file)]);
    } catch (error) {
      const status = ['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code) ? 404 : 400;
      if (!res.headersSent) send(res, status, { error: status === 404 ? 'Not found' : 'Request could not be processed' });
      else res.end();
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.CONTEXTGUARD_DEMO_PORT ?? 4187);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CONTEXTGUARD_DEMO_PORT');
  const server = createDemoServer();
  server.listen(port, '127.0.0.1', () => console.log(`ContextGuard local demo: http://127.0.0.1:${port}`));
}
