import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const routes = new Map([
  ['/', { file: join(root, 'public', 'index.html'), type: 'text/html; charset=utf-8' }],
  ['/app.css', { file: join(root, 'public', 'app.css'), type: 'text/css; charset=utf-8' }],
  ['/app.js', { file: join(root, 'public', 'app.js'), type: 'text/javascript; charset=utf-8' }],
  ['/game-catalog.js', { file: join(root, 'src', 'ui', 'game-catalog.js'), type: 'text/javascript; charset=utf-8' }],
]);

function securityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
}

export function createAppServer() {
  return http.createServer(async (request, response) => {
    securityHeaders(response);

    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}\n');
      return;
    }

    if (request.method === 'GET' && routes.has(request.url)) {
      const route = routes.get(request.url);
      try {
        const body = await readFile(route.file);
        response.writeHead(200, { 'Content-Type': route.type });
        response.end(body);
      } catch {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end('{"error":"asset_unavailable"}\n');
      }
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end('{"error":"not_found"}\n');
  });
}

function parsePort() {
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid PORT');
  return port;
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  const server = createAppServer();
  server.listen(parsePort(), '0.0.0.0');

  function shutdown() {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
