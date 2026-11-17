import { scryptSync } from 'node:crypto';
import { createApp, type AppOptions } from '../../src/app.ts';
import { createAuthService, COOKIE_NAME, hashToken, type SessionRecord, type SessionStore } from '../../src/modules/auth/session.ts';
export const TEST_PASSWORD = 'isolated-test-password-2026';
const salt = Buffer.alloc(16, 7);
export const authConfig = {
  username: 'budget-test', origin: 'https://budget.test',
  passwordHash: `scrypt$32768$8$3$${salt.toString('base64url')}$${scryptSync(TEST_PASSWORD, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('base64url')}`,
};
export function memoryStore() {
  const rows = new Map<string, SessionRecord>();
  const store: SessionStore = {
    async find(key) { return rows.get(key) ?? null; },
    async create(row) { rows.set(row.tokenHash, row); },
    async remove(key) { rows.delete(key); },
    async removeExpired(before) { for (const [key, row] of rows) if (row.expiresAt <= before) rows.delete(key); },
  };
  return { rows, store };
}
const token = Buffer.alloc(32, 1).toString('base64url');
const csrf = Buffer.alloc(32, 2).toString('base64url');
export const authenticatedHeaders = { Cookie: `${COOKIE_NAME}=${token}`, Origin: authConfig.origin, 'X-CSRF-Token': csrf };
export function testApp(options: AppOptions = {}) {
  const { rows, store } = memoryStore();
  rows.set(hashToken(token), {
    tokenHash: hashToken(token), csrfToken: csrf, credentialVersion: hashToken(`${authConfig.username}\0${authConfig.passwordHash}`),
    createdAt: new Date(), expiresAt: new Date('2099-01-01'),
  });
  return createApp({ ...options, auth: options.auth ?? createAuthService(authConfig, store) });
}
export const authenticatedFetch: typeof fetch = (input, options) => {
  const headers = new Headers(options?.headers);
  headers.set('Cookie', [headers.get('Cookie'), authenticatedHeaders.Cookie].filter(Boolean).join('; '));
  if (!headers.has('Origin')) headers.set('Origin', authenticatedHeaders.Origin);
  if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', authenticatedHeaders['X-CSRF-Token']);
  return globalThis.fetch(input, { ...options, headers });
};
