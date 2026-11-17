// 금융 데이터는 읽기만 합니다. 로그인/로그아웃에 따른 인증 세션만 생성·폐기합니다.
// 자격증명은 JSON 표준입력으로만 전달하며 출력하지 않습니다.
import assert from 'node:assert/strict';
const args = process.argv.slice(2);
const value = (name: string) => args[args.indexOf(name) + 1];
if (!args.includes('--base-url')) throw new Error('--base-url이 필요합니다.');
const base = new URL(value('--base-url')!);
if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('HTTPS 출처만 지정하세요.');
let input = '';
for await (const chunk of process.stdin) {
  input += String(chunk);
  if (Buffer.byteLength(input) > 16384) throw new Error('입력이 너무 깁니다.');
}
let credentials: { username: string; password: string; basicUsername?: string; basicPassword?: string };
try { credentials = JSON.parse(input); } catch { throw new Error('자격증명 입력 형식 오류.'); }
assert.equal(typeof credentials.username, 'string'); assert.equal(typeof credentials.password, 'string');
const outer: Record<string, string> = credentials.basicUsername ? { Authorization: `Basic ${Buffer.from(`${credentials.basicUsername}:${credentials.basicPassword ?? ''}`).toString('base64')}` } : {};
const origin = base.origin;
let cookie = ''; let csrf = ''; let checks = 0;
async function send(path: string, method = 'GET', headers: Record<string, string> = {}, body?: string) {
  return fetch(new URL(path, base), { method, headers: { ...outer, ...headers }, ...(body === undefined ? {} : { body }), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
}
async function require401(response: Response) {
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), null, 'Nginx Basic 401을 인증 성공 증거로 사용할 수 없습니다.');
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal((await response.json()).error.code, 'UNAUTHENTICATED'); checks++;
}
try {
  // Authorization은 유지하면서 Cookie만 생략합니다. 외곽 Basic 인증이 내부 세션 결함을 가리지 않게 합니다.
  for (const path of ['/ledger', '/categories', '/categories/__probe__', '/transactions', '/transactions/__probe__']) {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) await require401(await send('/api/v1' + path, method));
  }
  await require401(await send('/api/v1/auth/session'));
  const login = await send('/api/v1/auth/login', 'POST', { Origin: origin, 'X-Budget-Request': '1', 'Content-Type': 'application/json' }, JSON.stringify({ username: credentials.username, password: credentials.password }));
  assert.equal(login.status, 200); assert.match(login.headers.get('cache-control') ?? '', /no-store/);
  const issued = login.headers.get('set-cookie') ?? '';
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) assert.ok(issued.includes(flag));
  assert.doesNotMatch(issued, /Domain=/i); cookie = issued.split(';')[0]!;
  const authenticated = await login.json(); csrf = authenticated.csrfToken;
  assert.match(csrf, /^[A-Za-z0-9_-]{43}$/); checks++;
  const status = await send('/api/v1/auth/session', 'GET', { Cookie: cookie });
  assert.equal(status.status, 200); assert.equal((await status.json()).csrfToken, csrf); checks++;
  const ledger = await send('/api/v1/ledger', 'GET', { Cookie: cookie });
  assert.equal(ledger.status, 200); assert.match(ledger.headers.get('cache-control') ?? '', /no-store/);
  const data = await ledger.json(); assert.equal(data.version, 1); assert.ok(Array.isArray(data.categories) && Array.isArray(data.transactions)); checks++;
  // 잘못된 쿼리도 함께 사용하므로 CSRF 회귀가 있어도 금융 쓰기가 실행되지 않습니다.
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const denied = await send('/api/v1/transactions/__probe__?auth_probe=1', method, { Cookie: cookie, Origin: origin });
    assert.equal(denied.status, 403); assert.equal((await denied.json()).error.code, 'CSRF_REJECTED'); checks++;
  }
  const logout = await send('/api/v1/auth/logout', 'POST', { Cookie: cookie, Origin: origin, 'X-CSRF-Token': csrf, 'X-Budget-Request': '1' });
  assert.equal(logout.status, 204); assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/); checks++;
  await require401(await send('/api/v1/ledger', 'GET', { Cookie: cookie }));
  cookie = '';
  if (args.includes('--legacy-api-url')) {
    const legacy = new URL(value('--legacy-api-url')!);
    assert.equal(legacy.protocol, 'https:');
    const response = await fetch(new URL('/api/v1/ledger', legacy), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 401); assert.match(response.headers.get('www-authenticate') ?? '', /^Basic /); checks++;
  }
  console.log(`인증 검증 통과: ${checks}개. 금융 쓰기·응답 본문·인증정보 출력 없음.`);
} catch {
  console.error(`인증 검증 실패: ${checks}개 확인 후 중단했습니다. Basic 인증을 해제하지 마세요.`);
  process.exitCode = 1;
} finally {
  if (cookie && csrf) {
    try { await send('/api/v1/auth/logout', 'POST', { Cookie: cookie, Origin: origin, 'X-CSRF-Token': csrf, 'X-Budget-Request': '1' }); } catch { /* 실패 시 관리자가 해당 검증 세션을 폐기해야 합니다. */ }
  }
}
