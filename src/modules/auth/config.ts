import { validPasswordHash } from './password.ts';
export interface AuthConfig {
  username: string;
  passwordHash: string;
  origin: string;
}
export function readAuthConfig(source: NodeJS.ProcessEnv = process.env): AuthConfig {
  const username = source.AUTH_USERNAME?.trim() ?? '';
  const passwordHash = source.AUTH_PASSWORD_HASH ?? '';
  const origin = source.AUTH_ORIGIN ?? '';
  const errors: string[] = [];
  if (!username || username.length > 100) errors.push('AUTH_USERNAME');
  if (!validPasswordHash(passwordHash)) errors.push('AUTH_PASSWORD_HASH');
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error();
  } catch { errors.push('AUTH_ORIGIN'); }
  if (errors.length) throw new Error(`인증 설정 오류: ${errors.join(', ')}`);
  return { username, passwordHash, origin };
}
