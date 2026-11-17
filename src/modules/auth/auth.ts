import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { ApiError } from '../../middleware/errorHandler.ts';
import { emptyQuery, requireJson, requireNoBody } from '../../validation/request.ts';
import { clearSessionCookie, equalToken, readSessionToken, sessionCookie, type AuthService, type SessionRecord } from './session.ts';

const denied = () => new ApiError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
const forbidden = () => new ApiError(403, 'CSRF_REJECTED', '요청 출처 또는 보안 토큰을 확인해 주세요.');
export const noStore: RequestHandler = (_request, response, next) => {
  response.set({ 'Cache-Control': 'no-store, no-cache, must-revalidate, private', Pragma: 'no-cache', Expires: '0' });
  next();
};
export function assertOrigin(request: Request, auth: AuthService): void {
  if (request.get('Origin') !== auth.config.origin || request.get('Sec-Fetch-Site') === 'cross-site') throw forbidden();
}
export function requireSession(auth: AuthService): RequestHandler {
  return async (request, response, next) => {
    const session = await auth.authenticate(readSessionToken(request.get('Cookie')));
    if (!session) throw denied();
    response.locals.session = session;
    next();
  };
}
export function requireCsrf(auth: AuthService): RequestHandler {
  return (request, response, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      assertOrigin(request, auth);
      const token = request.get('X-CSRF-Token') ?? '';
      if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !equalToken(token, (response.locals.session as SessionRecord).csrfToken)) throw forbidden();
    }
    next();
  };
}
// 프로세스별 한도: IP당 15분 5회, 전체 15분 100회. 시도 시작 전에 차감하여 병렬 우회를 막습니다.
export function createLoginLimiter(now = Date.now): RequestHandler {
  const attempts = new Map<string, { count: number; until: number }>();
  let global = { count: 0, until: 0 };
  return (request, response, next) => {
    const time = now();
    for (const [key, entry] of attempts) if (entry.until <= time) attempts.delete(key);
    if (global.until <= time) global = { count: 0, until: time + 15 * 60_000 };
    const key = request.ip ?? 'unknown';
    const entry = attempts.get(key) ?? { count: 0, until: time + 15 * 60_000 };
    if (entry.count >= 5 || global.count >= 100) {
      response.set('Retry-After', String(Math.max(1, Math.ceil(((entry.count >= 5 ? entry.until : global.until) - time) / 1000))));
      throw new ApiError(429, 'LOGIN_RATE_LIMITED', '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.');
    }
    entry.count++; global.count++; attempts.set(key, entry);
    next();
  };
}
const credentials = z.strictObject({ username: z.string().min(1).max(100), password: z.string().min(1).refine(value => Buffer.byteLength(value) <= 1024) });
const sessionBody = (session: SessionRecord) => ({ authenticated: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt.toISOString() });
export function createAuthRouter(auth: AuthService): Router {
  const router = Router();
  router.post('/login', createLoginLimiter(), async (request, response) => {
    assertOrigin(request, auth);
    if (!request.secure || request.get('X-Budget-Request') !== '1') throw forbidden();
    emptyQuery.parse(request.query); requireJson(request);
    const { username, password } = credentials.parse(request.body);
    const result = await auth.login(username, password, readSessionToken(request.get('Cookie')));
    if (!result) throw new ApiError(401, 'INVALID_CREDENTIALS', '사용자명 또는 비밀번호를 확인해 주세요.');
    response.set('Set-Cookie', sessionCookie(result.token, result.session.expiresAt)).json(sessionBody(result.session));
  });
  router.get('/session', requireSession(auth), (request, response) => {
    emptyQuery.parse(request.query); requireNoBody(request, '세션 조회에는 본문을 포함할 수 없습니다.');
    response.json(sessionBody(response.locals.session as SessionRecord));
  });
  // 쿠키가 이미 만료된 경우에도 로그아웃은 멱등적으로 처리합니다.
  router.post('/logout', async (request, response) => {
    assertOrigin(request, auth);
    if (request.get('X-Budget-Request') !== '1') throw forbidden();
    emptyQuery.parse(request.query); requireNoBody(request);
    const token = readSessionToken(request.get('Cookie'));
    const session = await auth.authenticate(token);
    if (session) {
      const csrf = request.get('X-CSRF-Token') ?? '';
      if (!/^[A-Za-z0-9_-]{43}$/.test(csrf) || !equalToken(csrf, session.csrfToken)) throw forbidden();
    }
    await auth.logout(token);
    response.set('Set-Cookie', clearSessionCookie()).status(204).end();
  });
  return router;
}
