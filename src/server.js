import http from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '8080', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid PORT');

const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

  if (request.method === 'GET' && request.url === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true}\n');
    return;
  }

  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end('{"error":"not_found"}\n');
});

server.listen(port, '0.0.0.0');

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
