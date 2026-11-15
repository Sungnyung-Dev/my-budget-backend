import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { promisify } from 'node:util';
import { CategorySeedConflict, defaultCategories, seedCategories } from '../../prisma/seed-categories.ts';
import { env } from '../../src/config/env.ts';
import { prisma } from '../../src/db/prisma.ts';
import { dateToPrisma } from '../../src/domain/ledger.ts';
import { databaseTarget } from '../../scripts/database-target.ts';
import { assertLocalTestDatabase, fingerprintData } from '../helpers/database.ts';

test('운영 초기화의 생성·보존·충돌 롤백 및 읽기 전용 CLI를 로컬 DB에서 검증한다', async context => {
  assertLocalTestDatabase();
  const before = await fingerprintData();
  const prefix = `PS-${randomUUID().slice(0, 8)}`;
  const fixtures = defaultCategories.map((category, index) => ({
    ...category, id: `${prefix}-${index}`, name: `${prefix}-${index}`,
  }));
  const conflictId = `${prefix}-conflict`;
  const ownedIds = [...fixtures.map(category => category.id), conflictId];
  assert.equal(await prisma.category.count({ where: { id: { in: ownedIds } } }), 0);
  const clear = async () => {
    await prisma.transaction.deleteMany({ where: { categoryId: { in: ownedIds } } });
    await prisma.category.deleteMany({ where: { id: { in: ownedIds } } });
  };

  try {
    await context.test('기본 10개와 같은 로직으로 생성하고 재실행·이름/symbol 변경 후에도 기존 행을 보존한다', async () => {
      const rollback = new Error('초기화 생성·보존 테스트 롤백');
      await assert.rejects(prisma.$transaction(async tx => {
        const seeded = await seedCategories(tx, { strict: true });
        assert.equal(seeded.created + seeded.preserved, 10);
        for (const category of defaultCategories) {
          const saved = await tx.category.findUniqueOrThrow({ where: { id: category.id } });
          assert.equal(saved.type, category.type);
        }
        assert.deepEqual(await seedCategories(tx, { strict: true, categories: fixtures }), { created: 10, preserved: 0 });
        const rows = () => tx.category.findMany({ where: { id: { in: ownedIds } }, orderBy: { id: 'asc' } });
        const first = await rows();
        assert.deepEqual(first.map(({ createdAt: _created, updatedAt: _updated, ...category }) => category), fixtures);
        assert.deepEqual(await seedCategories(tx, { strict: true, categories: fixtures }), { created: 0, preserved: 10 });
        assert.deepEqual(await rows(), first);
        const category = fixtures[0]!;
        await tx.category.update({ where: { id: category.id }, data: { name: `${prefix}-renamed`, symbol: 'other' } });
        const transaction = await tx.transaction.create({ data: {
          categoryId: category.id, type: category.type, amount: 1n, date: dateToPrisma('2026-11-14'), memo: '보존 검증',
        } });
        const changed = await rows();
        await seedCategories(tx, { strict: true, categories: fixtures });
        assert.deepEqual(await rows(), changed, '이름·symbol·ID·타임스탬프를 덮어쓰면 안 됩니다.');
        assert.deepEqual(await tx.transaction.findUniqueOrThrow({ where: { id: transaction.id } }), transaction);
        throw rollback;
      }, { isolationLevel: 'Serializable', timeout: 20000 }), error => error === rollback);
    });

    await context.test('다른 ID의 동일 유형·이름은 collation 기준으로 충돌하며 앞서 생성한 행도 롤백한다', async () => {
      try {
        const last = fixtures.at(-1)!;
        const conflict = await prisma.category.create({ data: { ...last, id: conflictId, name: last.name.toLowerCase() } });
        await assert.rejects(prisma.$transaction(tx => seedCategories(tx, { strict: true, categories: fixtures }), {
          isolationLevel: 'Serializable',
        }), CategorySeedConflict);
        assert.equal(await prisma.category.count({ where: { id: { in: fixtures.map(category => category.id) } } }), 0);
        assert.deepEqual(await prisma.category.findUniqueOrThrow({ where: { id: conflictId } }), conflict);
        // 기존 개발용 이름 충돌 보존 정책도 유지합니다.
        assert.deepEqual(await prisma.$transaction(tx => seedCategories(tx, { categories: fixtures })), { created: 9, preserved: 1 });
        assert.deepEqual(await prisma.category.findUniqueOrThrow({ where: { id: conflictId } }), conflict);
      } finally {
        await clear();
      }
    });

    await context.test('동일 ID의 다른 유형을 거부하고 기존 행 및 앞선 생성 내용을 보존·롤백한다', async () => {
      try {
        const last = fixtures.at(-1)!;
        const conflict = await prisma.category.create({ data: { ...last, type: 'expense' } });
        await assert.rejects(prisma.$transaction(tx => seedCategories(tx, { strict: true, categories: fixtures }), {
          isolationLevel: 'Serializable',
        }), CategorySeedConflict);
        assert.equal(await prisma.category.count({ where: { id: { in: ownedIds } } }), 1);
        assert.deepEqual(await prisma.category.findUniqueOrThrow({ where: { id: last.id } }), conflict);
      } finally {
        await clear();
      }
    });

    await context.test('DB 점검과 확인 인자 없는 운영 초기화 CLI는 로컬 대상만 조회하고 변경하지 않는다', async () => {
      const childEnv: NodeJS.ProcessEnv = { ...process.env,
        NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3004', DATABASE_URL: env.DATABASE_URL,
      };
      delete childEnv.ENV_FILE;
      for (const script of ['scripts/check-database.ts', 'scripts/init-production-categories.ts']) {
        const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', script], {
          env: childEnv, timeout: 10000,
        });
        assert.equal(stderr, '');
        assert.ok(stdout.includes(databaseTarget(env).database));
        assert.ok(!stdout.includes(env.DATABASE_URL));
        assert.match(stdout, script.includes('init-') ? /조회만 완료했습니다/ : /읽기 전용/);
      }
      assert.deepEqual(await fingerprintData(), before);
    });
  } finally {
    try {
      await clear();
      assert.deepEqual(await fingerprintData(), before, '기존 Seed·거래·타임스탬프의 전체 해시가 같아야 합니다.');
      context.diagnostic(`기존 데이터 보존 확인: 카테고리 ${before.categories.count}개, 거래 ${before.transactions.count}개 (전체 행 SHA-256 일치)`);
    } finally {
      await prisma.$disconnect();
    }
  }
});
