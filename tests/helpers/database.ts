import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { env } from '../../src/config/env.ts';
import { prisma } from '../../src/db/prisma.ts';

export function assertLocalTestDatabase(): void {
  const url = new URL(env.DATABASE_URL);
  assert.ok(['development', 'test'].includes(env.NODE_ENV));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /_(dev|test)$/);
}

export async function fingerprintData() {
  assertLocalTestDatabase();
  const categories = await prisma.category.findMany({ orderBy: { id: 'asc' } });
  const transactions = await prisma.transaction.findMany({ orderBy: { id: 'asc' } });
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value,
    (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item)).digest('hex');
  return {
    categories: { count: categories.length, hash: hash(categories) },
    transactions: { count: transactions.length, hash: hash(transactions) },
  };
}
