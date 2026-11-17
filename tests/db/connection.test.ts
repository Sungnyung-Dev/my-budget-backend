import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../../src/config/env.ts';
import { databaseConnectionOptions } from '../../src/db/connection-options.ts';
import { PrismaClient } from '../../src/generated/prisma/client.ts';
import { assertLocalTestDatabase } from '../helpers/database.ts';

test('실제 격리 DB에서 어댑터 연결·연결 종료·새 풀 재연결 후 Session 조회', async () => {
  assertLocalTestDatabase();
  const options = databaseConnectionOptions(env.DATABASE_URL, process.env);
  assert.equal(options.allowPublicKeyRetrieval, false);
  const client = new PrismaClient({ adapter: new PrismaMariaDb(options) });
  try {
    await client.$connect();
    const [before] = await client.$queryRaw<{ database: string }[]>`SELECT DATABASE() AS \`database\``;
    assert.equal(before?.database, decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1)));
    await client.session.count();
    await client.$disconnect();
    await client.$connect();
    const [after] = await client.$queryRaw<{ database: string }[]>`SELECT DATABASE() AS \`database\``;
    assert.deepEqual(after, before);
    await client.session.count();
  } finally { await client.$disconnect(); }
});
