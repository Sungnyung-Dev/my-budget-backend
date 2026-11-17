import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '../../db/prisma.ts';
import type { AuthConfig } from './config.ts';
import { verifyPassword } from './password.ts';

export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const COOKIE_NAME = '__Host-budget_session';
export interface SessionRecord {
  tokenHash: string;
  csrfToken: string;
  credentialVersion: string;
  createdAt: Date;
  expiresAt: Date;
}
export interface SessionStore {
  find(tokenHash: string): Promise<SessionRecord | null>;
  create(session: SessionRecord): Promise<void>;
  remove(tokenHash: string): Promise<void>;
  removeExpired(before: Date): Promise<void>;
}
export const prismaSessionStore: SessionStore = {
  find: tokenHash => prisma.session.findUnique({ where: { tokenHash } }),
  async create(data) { await prisma.session.create({ data }); },
  async remove(tokenHash) { await prisma.session.deleteMany({ where: { tokenHash } }); },
  async removeExpired(before) { await prisma.session.deleteMany({ where: { expiresAt: { lte: before } } }); },
};
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const equalToken = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function readSessionToken(cookie: string | undefined): string | null {
  if (!cookie || cookie.length > 8192) return null;
  const matches = cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  const token = matches[0]!.slice(COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
export function sessionCookie(token: string, expiresAt: Date): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}; Expires=${expiresAt.toUTCString()}`;
}
export const clearSessionCookie = (): string => `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

export function createAuthService(config: AuthConfig, store: SessionStore = prismaSessionStore, now = () => new Date()) {
  const credentialVersion = hashToken(`${config.username}\0${config.passwordHash}`);
  return {
    config,
    async login(username: string, password: string, previousToken: string | null) {
      // 사용자명이 틀려도 동일한 scrypt 검증 비용을 사용합니다.
      const validPassword = await verifyPassword(password, config.passwordHash);
      if (!validPassword || username !== config.username) return null;
      const createdAt = now();
      const token = randomBytes(32).toString('base64url');
      const session: SessionRecord = {
        tokenHash: hashToken(token), csrfToken: randomBytes(32).toString('base64url'), credentialVersion,
        createdAt, expiresAt: new Date(createdAt.getTime() + SESSION_SECONDS * 1000),
      };
      // 로그인 시 만료 행을 정리합니다. 인증 판단은 정리 여부와 별개입니다.
      await store.removeExpired(createdAt);
      await store.create(session);
      if (previousToken) await store.remove(hashToken(previousToken));
      return { token, session };
    },
    async authenticate(token: string | null): Promise<SessionRecord | null> {
      if (!token) return null;
      const session = await store.find(hashToken(token));
      if (!session || session.expiresAt.getTime() <= now().getTime() || session.credentialVersion !== credentialVersion) return null;
      return session;
    },
    async logout(token: string | null) { if (token) await store.remove(hashToken(token)); },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
