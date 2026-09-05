import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../src/server.js';

async function withServer(run) {
  const server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('game lobby static shell is served with restrictive browser policy', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    const html = await response.text();
    assert.match(html, /9 APPROVED GAMES/);
    assert.match(html, /app\.js/);

    const catalog = await fetch(`${base}/game-catalog.js`);
    assert.equal(catalog.status, 200);
    assert.match(await catalog.text(), /Teen Patti/);
  });
});

test('unknown assets fail closed', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/..%2Fpackage.json`);
    assert.equal(response.status, 404);
  });
});
