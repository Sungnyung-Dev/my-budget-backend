import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/app.ts';
import { prisma } from '../../src/db/prisma.ts';
import { createAuthService, hashToken } from '../../src/modules/auth/session.ts';
import { authConfig, TEST_PASSWORD } from '../helpers/auth.ts';
import { assertLocalTestDatabase, fingerprintData } from '../helpers/database.ts';
import { withServer } from '../helpers/http.ts';

test('실제 격리 MySQL 세션 저장·서버 재생성·CRUD·만료·폐기 및 데이터 보존', async () => {
  assertLocalTestDatabase();
  const before = await fingerprintData();
  let cookie = ''; let csrf = ''; let tokenHash = ''; let categoryId = ''; let transactionId = '';
  const headers = () => ({ Cookie: cookie, Origin: authConfig.origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' });
  try {
    await withServer(createApp({ auth: createAuthService(authConfig) }), async base => {
      assert.equal((await fetch(base + '/api/v1/ledger')).status, 401);
      const response = await fetch(base + '/api/v1/auth/login', {
        method: 'POST', headers: { Origin: authConfig.origin, 'X-Forwarded-Proto': 'https', 'X-Budget-Request': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authConfig.username, password: TEST_PASSWORD }),
      });
      assert.equal(response.status, 200);
      cookie = response.headers.get('set-cookie')!.split(';')[0]!;
      csrf = (await response.json()).csrfToken;
      const rawToken = cookie.split('=')[1]!; tokenHash = hashToken(rawToken);
      const stored = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });
      assert.equal(stored.expiresAt.getTime() - stored.createdAt.getTime(), 30 * 86400_000);
      assert.ok(!JSON.stringify(stored).includes(rawToken));
      assert.equal((await fetch(base + '/api/v1/ledger', { headers: headers() })).status, 200);
    });
    // 새 앱 인스턴스에서도 프로세스 메모리 대신 DB 세션으로 인증됩니다.
    await withServer(createApp({ auth: createAuthService(authConfig) }), async base => {
      const status = await fetch(base + '/api/v1/auth/session', { headers: headers() }); assert.equal(status.status, 200);
      assert.equal((await status.json()).csrfToken, csrf);
      const createCategory = await fetch(base + '/api/v1/categories', { method: 'POST', headers: headers(), body: JSON.stringify({ name: 'AUTH-QA', type: 'expense', symbol: 'other' }) });
      assert.equal(createCategory.status, 201); categoryId = (await createCategory.json()).id;
      const createTransaction = await fetch(base + '/api/v1/transactions', { method: 'POST', headers: headers(), body: JSON.stringify({ categoryId, type: 'expense', amount: 1234, date: '2026-11-17', memo: '격리 테스트' }) });
      assert.equal(createTransaction.status, 201); transactionId = (await createTransaction.json()).id;
      const patch = await fetch(base + '/api/v1/transactions/' + transactionId, { method: 'PATCH', headers: headers(), body: JSON.stringify({ amount: 5678 }) });
      assert.equal(patch.status, 200); assert.equal((await patch.json()).amount, 5678);
      const denied = await fetch(base + '/api/v1/transactions/' + transactionId, { method: 'DELETE', headers: { ...headers(), 'X-CSRF-Token': 'A'.repeat(43) } });
      assert.equal(denied.status, 403); assert.ok(await prisma.transaction.findUnique({ where: { id: transactionId } }));
      const remove = await fetch(base + '/api/v1/transactions/' + transactionId, { method: 'DELETE', headers: headers() }); assert.equal(remove.status, 204); transactionId = '';
      const removeCategory = await fetch(base + '/api/v1/categories/' + categoryId, { method: 'DELETE', headers: headers() }); assert.equal(removeCategory.status, 204); categoryId = '';
      const expiry = (await prisma.session.findUniqueOrThrow({ where: { tokenHash } })).expiresAt;
      await prisma.session.update({ where: { tokenHash }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await fetch(base + '/api/v1/ledger', { headers: headers() })).status, 401);
      await prisma.session.update({ where: { tokenHash }, data: { expiresAt: expiry } });
      const logout = await fetch(base + '/api/v1/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: authConfig.origin, 'X-CSRF-Token': csrf, 'X-Budget-Request': '1' } });
      assert.equal(logout.status, 204); assert.equal(await prisma.session.count({ where: { tokenHash } }), 0);
      assert.equal((await fetch(base + '/api/v1/ledger', { headers: headers() })).status, 401);
    });
    assert.deepEqual(await fingerprintData(), before);
  } finally {
    if (transactionId) await prisma.transaction.deleteMany({ where: { id: transactionId } });
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    if (tokenHash) await prisma.session.deleteMany({ where: { tokenHash } });
    await prisma.$disconnect();
  }
});
