import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { databaseConnectionOptions } from '../src/db/connection-options.ts';

const url = 'mysql://budget:p%40ss@127.0.0.1:13316/my_budget_test';

test('기존 DB 옵션을 유지하고 공개키 자동 수신을 허용하지 않는다', () => {
  const options = databaseConnectionOptions(url, {});
  assert.equal(options.host, '127.0.0.1'); assert.equal(options.port, 13316);
  assert.equal(options.password, 'p@ss'); assert.equal(options.database, 'my_budget_test');
  assert.equal(options.allowPublicKeyRetrieval, false);
  assert.equal(options.ssl, undefined); assert.equal(options.cachingRsaPublicKey, undefined);
});

test('루프백 DB의 사전에 고정한 RSA 공개키만 허용한다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'budget-rsa-test-'));
  const file = join(directory, 'public.pem');
  try {
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = key.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    writeFileSync(file, pem);
    const options = databaseConnectionOptions(url, { DATABASE_RSA_PUBLIC_KEY_FILE: file });
    assert.equal(options.cachingRsaPublicKey, pem); assert.equal(options.allowPublicKeyRetrieval, false);
    assert.throws(() => databaseConnectionOptions(url.replace('127.0.0.1', 'db.example.com'), { DATABASE_RSA_PUBLIC_KEY_FILE: file }));
    for (const invalid of ['private-detail', key.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()]) {
      writeFileSync(file, invalid);
      assert.throws(() => databaseConnectionOptions(url, { DATABASE_RSA_PUBLIC_KEY_FILE: file }), error => {
        assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /private-detail|BEGIN|p@ss/); return true;
      });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('빈 파일 설정·누락 파일·잘못된 CA·중복 보안 설정을 비밀값 없이 거절한다', () => {
  for (const settings of [
    { DATABASE_RSA_PUBLIC_KEY_FILE: '' }, { DATABASE_RSA_PUBLIC_KEY_FILE: '/private-detail/not-found' },
    { DATABASE_TLS_CA_FILE: '' }, { DATABASE_TLS_CA_FILE: '/private-detail/not-found' },
    { DATABASE_TLS_CA_FILE: 'private-detail', DATABASE_RSA_PUBLIC_KEY_FILE: 'private-detail' },
  ]) {
    assert.throws(() => databaseConnectionOptions(url, settings), error => {
      assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /private-detail|p@ss/); return true;
    });
  }
});
