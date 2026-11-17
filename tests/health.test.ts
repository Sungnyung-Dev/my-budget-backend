import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { testApp } from './helpers/auth.ts';
const app = testApp();

test('/health는 DB 조회 없이 HTTP 200 JSON을 반환한다', async () => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/transactions`)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
