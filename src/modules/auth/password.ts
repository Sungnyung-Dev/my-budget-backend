import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const prefix = 'scrypt$32768$8$3$';
export const validPasswordHash = (value: string): boolean => /^scrypt\$32768\$8\$3\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/.test(value);
const derive = (password: string, salt: Buffer): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => {
    if (error) reject(error); else resolve(key);
  });
});
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || Buffer.byteLength(password) > 1024) throw new Error('비밀번호는 12자 이상, UTF-8 1024바이트 이하여야 합니다.');
  const salt = randomBytes(16);
  return `${prefix}${salt.toString('base64url')}$${(await derive(password, salt)).toString('base64url')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (!validPasswordHash(encoded) || Buffer.byteLength(password) > 1024) return false;
  const parts = encoded.split('$');
  return timingSafeEqual(await derive(password, Buffer.from(parts[4]!, 'base64url')), Buffer.from(parts[5]!, 'base64url'));
}
