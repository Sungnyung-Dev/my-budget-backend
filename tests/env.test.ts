import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEnv } from '../src/config/env.ts';

const valid = {
  NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3000',
  DATABASE_URL: 'mysql://budget:example%40password@localhost:3306/my_budget_dev',
};

test('필수 환경변수와 포트를 파싱한다', () => {
  assert.equal(parseEnv(valid).PORT, 3000);
  assert.equal(parseEnv({ ...valid, HOST: '::1' }).HOST, '::1');
});

test('누락된 환경변수 이름을 모두 표시한다', () => {
  assert.throws(() => parseEnv({}), error => {
    assert.ok(error instanceof Error);
    for (const name of Object.keys(valid)) assert.match(error.message, new RegExp(name));
    return true;
  });
});

test('잘못된 환경변수는 인증정보를 노출하지 않고 거부한다', () => {
  for (const [key, value] of [
    ['NODE_ENV', 'staging'], ['HOST', 'https://localhost'], ['PORT', '0'],
    ['PORT', '65536'], ['PORT', '3e3'], ['PORT', '3000.5'],
    ['DATABASE_URL', 'postgresql://user:secret@localhost/db'],
    ['DATABASE_URL', 'mysql://user:secret@localhost/'],
    ['DATABASE_URL', 'mysql://user:secret@localhost:70000/db'],
    ['DATABASE_URL', 'mysql://user:secret@localhost/db?timezone=local'],
    ['DATABASE_URL', 'mysql://user:secret@localhost/db#fragment'],
  ]) {
    assert.throws(() => parseEnv({ ...valid, [key!]: value }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(key!));
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  }
});
