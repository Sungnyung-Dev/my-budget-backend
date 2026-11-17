import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { testApp as createApp, authenticatedFetch as fetch } from '../helpers/auth.ts';
import { env } from '../../src/config/env.ts';
import { prisma } from '../../src/db/prisma.ts';
import { dateToPrisma, type CategoryDto } from '../../src/domain/ledger.ts';
import { createCategoriesService } from '../../src/modules/categories/categories.service.ts';
import { jsonRequest, withServer } from '../helpers/http.ts';
import { fingerprintData } from '../helpers/database.ts';

async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
}

test('실제 로컬 DB에서 카테고리 API와 경합을 검증하고 기존 데이터를 보존한다', async context => {
  const url = new URL(env.DATABASE_URL);
  assert.ok(['development', 'test'].includes(env.NODE_ENV));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /_(dev|test)$/);

  try {
    const before = await fingerprintData();
    await context.test('조회·필터·생성·수정·삭제·참조 보호는 HTTP를 통해 검증하고 롤백한다', async () => {
      const rollback = new Error('API 테스트 데이터 롤백');
      await assert.rejects(prisma.$transaction(async tx => {
        await withServer(createApp({ categoriesService: createCategoriesService(tx) }), async base => {
          const endpoint = `${base}/api/v1/categories`;
          const prefix = `API-${randomUUID().slice(0, 8)}`;
          const create = async (name: string, type: 'expense' | 'income' = 'expense') => {
            const response = await fetch(endpoint, jsonRequest('POST', { name, type, symbol: 'other' }));
            assert.equal(response.status, 201);
            const category = await response.json() as CategoryDto;
            assert.match(category.id, /^[\da-f-]{36}$/);
            assert.deepEqual(Object.keys(category).sort(), ['id', 'name', 'symbol', 'type']);
            return category;
          };
          const expenseA = await create(`  ${prefix}-A  `);
          const expenseB = await create(`${prefix}-B`);
          const income = await create(expenseA.name, 'income');
          assert.equal(expenseA.name, `${prefix}-A`);

          const allResponse = await fetch(endpoint);
          assert.equal(allResponse.status, 200);
          const all = await allResponse.json() as CategoryDto[];
          assert.deepEqual(await (await fetch(endpoint)).json(), all);
          const own = all.filter(category => category.name.startsWith(prefix));
          assert.deepEqual(own.map(category => category.id), [expenseA.id, expenseB.id, income.id]);
          for (const type of ['expense', 'income']) {
            const response = await fetch(`${endpoint}?type=${type}`);
            assert.equal(response.status, 200);
            const filtered = await response.json() as CategoryDto[];
            assert.deepEqual(filtered, all.filter(category => category.type === type));
          }

          await expectError(await fetch(endpoint, jsonRequest('POST', {
            name: expenseA.name.toLowerCase(), type: 'expense', symbol: 'food',
          })), 409, 'CATEGORY_NAME_CONFLICT');
          await expectError(await fetch(`${endpoint}/${expenseB.id}`, jsonRequest('PATCH', {
            name: expenseA.name.toLowerCase(),
          })), 409, 'CATEGORY_NAME_CONFLICT');
          const unchanged = await fetch(`${endpoint}/${expenseA.id}`, jsonRequest('PATCH', { name: expenseA.name }));
          assert.equal(unchanged.status, 200);
          assert.deepEqual(await unchanged.json(), expenseA);

          const transaction = await tx.transaction.create({ data: {
            categoryId: expenseA.id, type: 'expense', amount: 1n, date: dateToPrisma('2026-11-14'), memo: 'API 검증',
          } });
          const renamed = await fetch(`${endpoint}/${expenseA.id}`, jsonRequest('PATCH', { name: `  ${prefix}-C  ` }));
          assert.equal(renamed.status, 200);
          assert.deepEqual(await renamed.json(), { ...expenseA, name: `${prefix}-C` });
          assert.equal((await tx.transaction.findUniqueOrThrow({ where: { id: transaction.id } })).categoryId, expenseA.id);
          await expectError(await fetch(`${endpoint}/${expenseA.id}`, { method: 'DELETE' }), 409, 'CATEGORY_IN_USE');
          assert.ok(await tx.category.findUnique({ where: { id: expenseA.id } }));
          await expectError(await fetch(`${endpoint}/${expenseA.id}`, jsonRequest('PATCH', {
            name: '금지', type: 'income',
          })), 400, 'INVALID_REQUEST');
          await expectError(await fetch(`${endpoint}/${expenseA.id}`, jsonRequest('PATCH', {
            name: '금지', symbol: 'food',
          })), 400, 'INVALID_REQUEST');

          const deleted = await fetch(`${endpoint}/${expenseB.id}`, { method: 'DELETE' });
          assert.equal(deleted.status, 204);
          assert.equal(await deleted.text(), '');
          assert.equal(await tx.category.findUnique({ where: { id: expenseB.id } }), null);
          await expectError(await fetch(`${endpoint}/${expenseB.id}`, { method: 'DELETE' }), 404, 'CATEGORY_NOT_FOUND');
          await expectError(await fetch(`${endpoint}/${randomUUID()}`, jsonRequest('PATCH', { name: '없음' })), 404, 'CATEGORY_NOT_FOUND');
          await expectError(await fetch(`${endpoint}/${randomUUID()}`, { method: 'DELETE' }), 404, 'CATEGORY_NOT_FOUND');
        });
        throw rollback;
      }, { timeout: 30_000 }), error => error === rollback);
    });

    await context.test('동시 생성·이름 변경 충돌과 동시 삭제는 일관된 상태 코드를 반환한다', async () => {
      const prefix = `R-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const ownedNames = [`${prefix}-A`, `${prefix}-B`, `${prefix}-C`];
      assert.equal(await prisma.category.count({ where: { name: { in: ownedNames } } }), 0);
      const ids = new Set<string>();
      try {
        await withServer(createApp(), async base => {
          const endpoint = `${base}/api/v1/categories`;
          const create = (name: string) => fetch(endpoint, jsonRequest('POST', { name, type: 'expense', symbol: 'other' }));
          const created = await Promise.all([create(ownedNames[0]!), create(ownedNames[0]!.toLowerCase())]);
          assert.deepEqual(created.map(response => response.status).sort(), [201, 409]);
          for (const response of created) {
            if (response.status === 201) ids.add((await response.json() as CategoryDto).id);
            else await expectError(response, 409, 'CATEGORY_NAME_CONFLICT');
          }
          const second = await create(ownedNames[1]!);
          assert.equal(second.status, 201);
          ids.add((await second.json() as CategoryDto).id);

          const renamed = await Promise.all([...ids].map(id => fetch(`${endpoint}/${id}`, jsonRequest('PATCH', { name: ownedNames[2] }))));
          assert.deepEqual(renamed.map(response => response.status).sort(), [200, 409]);
          for (const response of renamed) {
            if (response.status === 409) await expectError(response, 409, 'CATEGORY_NAME_CONFLICT');
            else await response.json();
          }
          const id = [...ids][0]!;
          const deleted = await Promise.all([
            fetch(`${endpoint}/${id}`, { method: 'DELETE' }), fetch(`${endpoint}/${id}`, { method: 'DELETE' }),
          ]);
          assert.deepEqual(deleted.map(response => response.status).sort(), [204, 404]);
          for (const response of deleted) {
            if (response.status === 404) await expectError(response, 404, 'CATEGORY_NOT_FOUND');
          }
        });
      } finally {
        // 사전에 미사용 확인한 테스트 전용 이름과 ID의 행만 정리합니다.
        const owned = await prisma.category.findMany({ where: { name: { in: ownedNames } } });
        for (const category of owned) ids.add(category.id);
        await prisma.category.deleteMany({ where: { id: { in: [...ids] } } });
      }
    });

    assert.deepEqual(await fingerprintData(), before, '기존 카테고리·거래 및 타임스탬프가 변경되지 않아야 합니다.');
    context.diagnostic(`기존 데이터 보존 확인: 카테고리 ${before.categories.count}개, 거래 ${before.transactions.count}개 (전체 행 SHA-256 일치)`);
  } finally {
    await prisma.$disconnect();
  }
});
