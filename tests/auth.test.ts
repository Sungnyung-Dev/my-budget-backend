import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.ts';
import { readAuthConfig } from '../src/modules/auth/config.ts';
import { createAuthService, COOKIE_NAME, hashToken, readSessionToken, SESSION_SECONDS } from '../src/modules/auth/session.ts';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.ts';
import { authConfig, memoryStore, TEST_PASSWORD } from './helpers/auth.ts';
import { withServer } from './helpers/http.ts';

const loginHeaders = { 'Content-Type': 'application/json', Origin: authConfig.origin, 'X-Budget-Request': '1', 'X-Forwarded-Proto': 'https' };
const loginBody = JSON.stringify({ username: authConfig.username, password: TEST_PASSWORD });
async function fixture(run: (base: string, data: ReturnType<typeof memoryStore>, clock: { now: Date }) => Promise<void>) {
  const data = memoryStore(); const clock = { now: new Date('2026-11-17T12:00:00Z') };
  await withServer(createApp({ auth: createAuthService(authConfig, data.store, () => clock.now), ledgerService: { get: async () => ({ version: 1, categories: [], transactions: [] }) } }), base => run(base, data, clock));
}
async function login(base: string, headers: Record<string, string> = loginHeaders, body = loginBody) {
  return fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers, body });
}
async function signedIn(base: string) {
  const response = await login(base); assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const body = await response.json();
  return { cookie, csrf: body.csrfToken as string, body, response };
}
const noCache = (res: Response) => { assert.match(res.headers.get('cache-control')!, /no-store/); assert.equal(res.headers.get('www-authenticate'), null); };

test('단일 계정 환경설정은 잘못된 해시·출처를 비밀값 없이 거절한다', () => {
  const valid = { AUTH_USERNAME: authConfig.username, AUTH_PASSWORD_HASH: authConfig.passwordHash, AUTH_ORIGIN: authConfig.origin };
  assert.deepEqual(readAuthConfig(valid), authConfig);
  for (const change of [{ AUTH_USERNAME: '' }, { AUTH_PASSWORD_HASH: 'secret-plaintext' }, { AUTH_ORIGIN: 'http://budget.test' }, { AUTH_ORIGIN: 'https://budget.test/path' }, { AUTH_ORIGIN: 'https://budget.test/' }]) {
    assert.throws(() => readAuthConfig({ ...valid, ...change }), error => error instanceof Error && !/secret-plaintext/.test(error.message));
  }
  const saved = { ...process.env };
  try {
    for (const key of ['AUTH_USERNAME', 'AUTH_PASSWORD_HASH', 'AUTH_ORIGIN']) delete process.env[key];
    assert.throws(() => createApp(), /인증 설정 오류/);
  } finally { Object.assign(process.env, saved); }
});

test('scrypt는 솔트마다 다른 해시, 정확한 비밀번호만 허용한다', async () => {
  const first = await hashPassword(TEST_PASSWORD); const second = await hashPassword(TEST_PASSWORD);
  assert.notEqual(first, second); assert.ok(await verifyPassword(TEST_PASSWORD, first));
  assert.equal(await verifyPassword('wrong', first), false); assert.equal(await verifyPassword('wrong', 'bad'), false);
  await assert.rejects(hashPassword('short')); await assert.rejects(hashPassword('가'.repeat(400)));
});

test('무인증 금융 경로의 모든 메서드는 서비스 호출 없이 401 및 no-store', async () => fixture(async base => {
  for (const path of ['/ledger', '/categories', '/categories/id', '/transactions', '/transactions/id', '/future']) {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await fetch(`${base}/api/v1${path}`, { method });
      assert.equal(response.status, 401, `${method} ${path}`); noCache(response);
    }
  }
  const malformed = await fetch(`${base}/api/v1/transactions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 401); noCache(malformed);
}));

test('로그인은 고정 30일 보안 쿠키를 발급하고 DB에는 원본 세션 토큰을 저장하지 않는다', async () => fixture(async (base, { rows }, clock) => {
  const { cookie, response, body } = await signedIn(base); noCache(response);
  const header = response.headers.get('set-cookie')!;
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${SESSION_SECONDS}`]) assert.ok(header.includes(flag));
  assert.doesNotMatch(header, /Domain=/i);
  const token = cookie.split('=')[1]!; assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(body).sort(), ['authenticated', 'csrfToken', 'expiresAt']);
  const row = rows.get(hashToken(token))!; assert.ok(row);
  assert.equal(row.expiresAt.getTime() - clock.now.getTime(), 30 * 86400_000);
  assert.ok(!JSON.stringify([...rows]).includes(token));
  assert.notEqual(row.csrfToken, token);
  const session = await fetch(`${base}/api/v1/auth/session`, { headers: { Cookie: cookie } });
  assert.equal(session.status, 200); noCache(session);
  assert.equal(session.headers.get('set-cookie'), null); assert.deepEqual(await session.json(), body);
  assert.equal((await fetch(`${base}/api/v1/ledger`, { headers: { Cookie: cookie } })).status, 200);
}));

test('잘못된 계정·비밀번호는 동일한 오류이며 세션·쿠키를 만들지 않는다', async () => fixture(async (base, { rows }) => {
  let previous: unknown;
  for (const credentials of [{ username: 'unknown', password: TEST_PASSWORD }, { username: authConfig.username, password: 'wrong' }]) {
    const res = await login(base, loginHeaders, JSON.stringify(credentials));
    assert.equal(res.status, 401); assert.equal(res.headers.get('set-cookie'), null); noCache(res);
    const error = await res.json(); if (previous) assert.deepEqual(error, previous); previous = error;
  }
  assert.equal(rows.size, 0);
}));

test('로그인은 Origin·전용 헤더·HTTPS를 필수로 요구하고 sibling 출처도 거절한다', async () => {
  for (const change of [{ Origin: '' }, { Origin: 'null' }, { Origin: 'https://evil.budget.test' }, { 'X-Budget-Request': '' }, { 'X-Forwarded-Proto': 'http' }, { 'Sec-Fetch-Site': 'cross-site' }] as Record<string, string>[]) {
    await fixture(async (base, { rows }) => { const res = await login(base, { ...loginHeaders, ...change }); assert.equal(res.status, 403); noCache(res); assert.equal(rows.size, 0); });
  }
});

test('로그인 본문·콘텐츠 형식 오류와 서버 오류에도 no-store를 유지한다', async () => fixture(async base => {
  for (const body of ['{', '{}', JSON.stringify({ username: 'budget', password: 'x', admin: true })]) {
    const response = await login(base, loginHeaders, body); assert.equal(response.status, 400); noCache(response);
  }
  assert.equal((await login(base, { ...loginHeaders, 'Content-Type': 'text/plain' })).status, 400);
}));

test('동시 로그인 시도도 IP 한도를 우회하지 못한다', async () => fixture(async base => {
  const responses = await Promise.all(Array.from({ length: 8 }, () => login(base, loginHeaders, JSON.stringify({ username: 'unknown', password: 'wrong' }))));
  assert.equal(responses.filter(res => res.status === 401).length, 5);
  assert.equal(responses.filter(res => res.status === 429).length, 3);
  for (const res of responses.filter(res => res.status === 429)) { assert.ok(Number(res.headers.get('retry-after')) > 0); noCache(res); }
}));

test('위조·중복·잘못된 쿠키와 Bearer·신뢰 헤더만으로는 접근할 수 없다', async () => fixture(async base => {
  const { cookie } = await signedIn(base);
  for (const value of [`${COOKIE_NAME}=${'A'.repeat(43)}`, `${cookie}; ${cookie}`, `${COOKIE_NAME}=%bad`, `${COOKIE_NAME}=short`, 'unrelated=value']) {
    const response = await fetch(`${base}/api/v1/ledger`, { headers: { Cookie: value, Authorization: 'Basic dGVzdDp0ZXN0', 'X-Authenticated-User': 'budget' } });
    assert.equal(response.status, 401); noCache(response);
  }
  assert.equal(readSessionToken(`${COOKIE_NAME}=${'A'.repeat(9000)}`), null);
}));

test('서버 만료 경계는 30일 직전 허용, 정확한 만료 시각부터 거절하며 갱신하지 않는다', async () => fixture(async (base, { rows }, clock) => {
  const { cookie, body } = await signedIn(base);
  clock.now = new Date(Date.parse(body.expiresAt) - 1);
  assert.equal((await fetch(`${base}/api/v1/ledger`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal([...rows.values()][0]!.expiresAt.toISOString(), body.expiresAt);
  clock.now = new Date(body.expiresAt);
  for (const path of ['/api/v1/ledger', '/api/v1/auth/session']) {
    const response = await fetch(base + path, { headers: { Cookie: cookie } }); assert.equal(response.status, 401); noCache(response);
  }
}));

test('로그인 시 이전 세션을 교체하고 별도 기기의 세션은 유지한다', async () => fixture(async base => {
  const first = await signedIn(base); const otherDevice = await signedIn(base);
  const next = await login(base, { ...loginHeaders, Cookie: first.cookie }); assert.equal(next.status, 200);
  assert.notEqual(next.headers.get('set-cookie')!.split(';')[0], first.cookie);
  assert.equal((await fetch(`${base}/api/v1/ledger`, { headers: { Cookie: first.cookie } })).status, 401);
  assert.equal((await fetch(`${base}/api/v1/ledger`, { headers: { Cookie: otherDevice.cookie } })).status, 200);
}));

test('POST·PATCH·DELETE는 Origin과 세션 CSRF 토큰을 모두 검증한 후 CRUD로 전달한다', async () => fixture(async base => {
  const { cookie, csrf } = await signedIn(base); const other = await signedIn(base);
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    for (const change of [{ Origin: '' }, { Origin: 'https://evil.budget.test' }, { 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'A'.repeat(43) }, { 'X-CSRF-Token': other.csrf }]) {
      const response = await fetch(`${base}/api/v1/categories/id`, { method, headers: { Cookie: cookie, Origin: authConfig.origin, 'X-CSRF-Token': csrf, ...change } });
      assert.equal(response.status, 403); noCache(response);
    }
  }
  // 올바른 인증·CSRF이면 기존 본문 검증으로 전달되어 400입니다.
  const valid = await fetch(`${base}/api/v1/categories`, { method: 'POST', headers: { Cookie: cookie, Origin: authConfig.origin, 'X-CSRF-Token': csrf } });
  assert.equal(valid.status, 400);
}));

test('로그아웃은 세션을 서버에서 삭제하고 예전 쿠키 재사용을 거절한다', async () => fixture(async (base, { rows }) => {
  const { cookie, csrf } = await signedIn(base);
  const headers = { Cookie: cookie, Origin: authConfig.origin, 'X-CSRF-Token': csrf, 'X-Budget-Request': '1' };
  const bad = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { ...headers, 'X-CSRF-Token': '' } }); assert.equal(bad.status, 403); assert.equal(rows.size, 1);
  const res = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers });
  assert.equal(res.status, 204); noCache(res); assert.match(res.headers.get('set-cookie')!, /Max-Age=0/); assert.equal(rows.size, 0);
  assert.equal((await fetch(`${base}/api/v1/ledger`, { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers })).status, 204);
}));

test('비밀번호 해시 또는 사용자명 변경 시 기존 모든 세션이 무효화된다', async () => {
  const { store } = memoryStore();
  const oldAuth = createAuthService(authConfig, store); const session = await oldAuth.login(authConfig.username, TEST_PASSWORD, null); assert.ok(session);
  for (const change of [{ username: 'changed-user' }, { passwordHash: await hashPassword(TEST_PASSWORD) }]) {
    assert.equal(await createAuthService({ ...authConfig, ...change }, store).authenticate(session.token), null);
  }
});

test('세션 DB 장애 시 fail-closed 500과 no-store, 금융 서비스 미호출 및 로그 비밀값 미노출', async () => {
  const { store } = memoryStore(); let calls = 0; const logs: unknown[] = [];
  store.find = async () => { throw new Error('secret-cookie-and-sql'); };
  await withServer(createApp({ auth: createAuthService(authConfig, store), ledgerService: { get: async () => { calls++; throw new Error(); } }, logger: entry => logs.push(entry) }), async base => {
    const res = await fetch(`${base}/api/v1/ledger`, { headers: { Cookie: `${COOKIE_NAME}=${'A'.repeat(43)}` } });
    assert.equal(res.status, 500); noCache(res); assert.equal(calls, 0); assert.doesNotMatch(JSON.stringify(logs), /secret-cookie-and-sql|AAAAAA/);
  });
});
