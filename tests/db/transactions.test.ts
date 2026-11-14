import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../../src/app.ts';
import { prisma } from '../../src/db/prisma.ts';
import { dateToPrisma, MAX_AMOUNT, type TransactionDto } from '../../src/domain/ledger.ts';
import { jsonRequest, withServer } from '../helpers/http.ts';
import { assertLocalTestDatabase, fingerprintData } from '../helpers/database.ts';

async function expectError(response: Response, status: number, code: string): Promise<void> {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
}

test('거래 CRUD·정합성·합계 한도·실제 동시 요청을 검증하고 기존 데이터를 보존한다', async context => {
  assertLocalTestDatabase();
  const before = await fingerprintData();
  const prefix = `TX-${randomUUID().slice(0, 8)}`;
  const expense = `${prefix}-expense`;
  const otherExpense = `${prefix}-other`;
  const income = `${prefix}-income`;
  const raceCategory = `${prefix}-race`;
  const ownedCategories = [expense, otherExpense, income, raceCategory];
  const clearTransactions = () => prisma.transaction.deleteMany({ where: { categoryId: { in: ownedCategories } } });
  const grossTotal = async () => (await prisma.transaction.aggregate({ _sum: { amount: true } }))._sum.amount ?? 0n;
  const input = { type: 'expense', amount: 9000, categoryId: expense, date: '2026-11-14', memo: ' 점심 ' };

  try {
    await prisma.category.createMany({ data: [
      { id: expense, name: `${prefix}-E`, type: 'expense', symbol: 'other' },
      { id: otherExpense, name: `${prefix}-O`, type: 'expense', symbol: 'other' },
      { id: income, name: `${prefix}-I`, type: 'income', symbol: 'income' },
      { id: raceCategory, name: `${prefix}-R`, type: 'expense', symbol: 'other' },
    ] });

    await context.test('전체·기간·단건 조회, BIGINT/DATE DTO와 부분 수정 및 404를 검증한다', async () => {
      try {
        await withServer(createApp(), async base => {
          const endpoint = `${base}/api/v1/transactions`;
          const create = async (body = input): Promise<TransactionDto> => {
            const response = await fetch(endpoint, jsonRequest('POST', body));
            assert.equal(response.status, 201);
            const row = await response.json() as TransactionDto;
            assert.match(row.id, /^[\da-f-]{36}$/);
            assert.deepEqual(Object.keys(row).sort(), ['amount', 'categoryId', 'date', 'id', 'memo', 'type']);
            return row;
          };
          const first = await create();
          assert.deepEqual(first, { ...input, id: first.id, memo: '점심' });
          const max = await create({ ...input, amount: MAX_AMOUNT, date: '2026-11-15', memo: '' });
          const min = await create({ ...input, amount: 1, memo: '😀'.repeat(50) });
          assert.equal(max.amount, MAX_AMOUNT);
          assert.equal(min.amount, 1);
          for (const row of [first, max, min]) {
            assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } })).amount, BigInt(row.amount));
            const response = await fetch(`${endpoint}/${row.id}`);
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), row);
          }
          const allResponse = await fetch(endpoint);
          assert.equal(allResponse.status, 200);
          const all = await allResponse.json() as TransactionDto[];
          const own = all.filter(row => row.categoryId === expense);
          assert.equal(own[0]?.id, max.id);
          assert.deepEqual(own.slice(1).map(row => row.id), [first.id, min.id].sort());
          for (const [query, from, to] of [
            ['?from=2026-11-14&to=2026-11-15', '2026-11-14', '2026-11-15'],
            ['?from=2026-11-15', '2026-11-15', undefined],
            ['?to=2026-11-15', undefined, '2026-11-15'],
            ['?from=2026-11-14&to=2026-11-14', '2026-11-14', '2026-11-14'],
          ]) {
            const response = await fetch(`${endpoint}${query}`);
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), all.filter(row => (!from || row.date >= from) && (!to || row.date < to)));
          }

          const patch = async (body: unknown): Promise<TransactionDto> => {
            const response = await fetch(`${endpoint}/${first.id}`, jsonRequest('PATCH', body));
            assert.equal(response.status, 200);
            return await response.json() as TransactionDto;
          };
          assert.deepEqual(await patch({ memo: '  수정  ' }), { ...first, memo: '수정' });
          assert.deepEqual(await patch({ categoryId: otherExpense }), { ...first, categoryId: otherExpense, memo: '수정' });
          await expectError(await fetch(`${endpoint}/${first.id}`, jsonRequest('PATCH', { type: 'income' })), 400, 'CATEGORY_TYPE_MISMATCH');
          await expectError(await fetch(`${endpoint}/${first.id}`, jsonRequest('PATCH', { categoryId: income })), 400, 'CATEGORY_TYPE_MISMATCH');
          const changed = await patch({ type: 'income', categoryId: income, amount: 1, date: '2024-02-29' });
          assert.deepEqual(changed, { ...first, type: 'income', categoryId: income, amount: 1, date: '2024-02-29', memo: '수정' });
          await expectError(await fetch(endpoint, jsonRequest('POST', { ...input, categoryId: randomUUID() })), 400, 'INVALID_CATEGORY');
          await expectError(await fetch(endpoint, jsonRequest('POST', { ...input, categoryId: income })), 400, 'CATEGORY_TYPE_MISMATCH');
          await expectError(await fetch(`${endpoint}/${first.id}`, jsonRequest('PATCH', { categoryId: randomUUID() })), 400, 'INVALID_CATEGORY');
          assert.deepEqual(await (await fetch(`${endpoint}/${first.id}`)).json(), changed);

          const deleted = await fetch(`${endpoint}/${first.id}`, { method: 'DELETE' });
          assert.equal(deleted.status, 204);
          assert.equal(await deleted.text(), '');
          for (const method of ['GET', 'PATCH', 'DELETE']) {
            await expectError(await fetch(`${endpoint}/${first.id}`, method === 'PATCH'
              ? jsonRequest(method, { memo: '없음' }) : { method }), 404, 'TRANSACTION_NOT_FOUND');
          }
          assert.equal((await fetch(`${base}/health`)).status, 200);
          assert.equal((await fetch(`${base}/api/v1/categories?type=income`)).status, 200);
        });
      } finally {
        await clearTransactions();
      }
    });

    await context.test('서로 다른 필드의 동시 PATCH, 수정·삭제 및 중복 삭제를 보호한다', async () => {
      try {
        await withServer(createApp(), async base => {
          const endpoint = `${base}/api/v1/transactions`;
          const created = await fetch(endpoint, jsonRequest('POST', input));
          assert.equal(created.status, 201);
          const row = await created.json() as TransactionDto;
          const updates = await Promise.all([
            fetch(`${endpoint}/${row.id}`, jsonRequest('PATCH', { amount: 1 })),
            fetch(`${endpoint}/${row.id}`, jsonRequest('PATCH', { memo: '동시 수정' })),
          ]);
          assert.deepEqual(updates.map(response => response.status), [200, 200]);
          const updated = await (await fetch(`${endpoint}/${row.id}`)).json() as TransactionDto;
          assert.equal(updated.amount, 1);
          assert.equal(updated.memo, '동시 수정');

          const [patch, deleted] = await Promise.all([
            fetch(`${endpoint}/${row.id}`, jsonRequest('PATCH', { memo: '마지막 수정' })),
            fetch(`${endpoint}/${row.id}`, { method: 'DELETE' }),
          ]);
          assert.equal(deleted.status, 204);
          assert.ok([200, 404].includes(patch.status));
          if (patch.status === 404) await expectError(patch, 404, 'TRANSACTION_NOT_FOUND');
          await expectError(await fetch(`${endpoint}/${row.id}`), 404, 'TRANSACTION_NOT_FOUND');

          const second = await (await fetch(endpoint, jsonRequest('POST', input))).json() as TransactionDto;
          const deletes = await Promise.all([
            fetch(`${endpoint}/${second.id}`, { method: 'DELETE' }), fetch(`${endpoint}/${second.id}`, { method: 'DELETE' }),
          ]);
          assert.deepEqual(deletes.map(response => response.status).sort(), [204, 404]);
        });
      } finally {
        await clearTransactions();
      }
    });

    await context.test('카테고리 삭제와 거래 생성이 경합해도 고아 거래가 생기지 않는다', async () => {
      try {
        await withServer(createApp(), async base => {
          const [created, deleted] = await Promise.all([
            fetch(`${base}/api/v1/transactions`, jsonRequest('POST', { ...input, categoryId: raceCategory })),
            fetch(`${base}/api/v1/categories/${raceCategory}`, { method: 'DELETE' }),
          ]);
          if (created.status === 201) {
            await expectError(deleted, 409, 'CATEGORY_IN_USE');
          } else {
            await expectError(created, 400, 'INVALID_CATEGORY');
            assert.equal(deleted.status, 204);
          }
        });
      } finally {
        await clearTransactions();
      }
    });

    await context.test('실제 안전 정수 한도에서 동시 POST·PATCH와 합계 감소를 검증한다', async () => {
      const limit = BigInt(Number.MAX_SAFE_INTEGER);
      const original = await grossTotal();
      assert.ok(original <= limit - BigInt(MAX_AMOUNT) - 20n, '한도 검증에는 여유 있는 개발·테스트 DB가 필요합니다.');
      let sequence = 0;
      const fillTo = async (target: bigint) => {
        let remaining = target - await grossTotal();
        assert.ok(remaining >= 0n);
        while (remaining > 0n) {
          const data = [];
          for (let index = 0; index < 500 && remaining > 0n; index++) {
            const amount = remaining > BigInt(MAX_AMOUNT) ? BigInt(MAX_AMOUNT) : remaining;
            remaining -= amount;
            data.push({ id: `${prefix}-limit-${sequence++}`, categoryId: expense, type: 'expense' as const,
              amount, date: dateToPrisma('2026-11-14'), memo: '합계 한도 검증용' });
          }
          await prisma.transaction.createMany({ data });
        }
      };

      try {
        // 두 앱 인스턴스가 각자의 트랜잭션으로 같은 DB에 쓰도록 검증합니다.
        await withServer(createApp(), async firstBase => withServer(createApp(), async secondBase => {
          const endpoints = [firstBase, secondBase].map(base => `${base}/api/v1/transactions`);
          await fillTo(limit - 1n);
          const creates = await Promise.all(endpoints.map(endpoint => fetch(endpoint, jsonRequest('POST', { ...input, amount: 1 }))));
          assert.deepEqual(creates.map(response => response.status).sort(), [201, 409]);
          assert.equal(await grossTotal(), limit);
          let winnerId = '';
          for (const response of creates) {
            if (response.status === 201) winnerId = (await response.json() as TransactionDto).id;
            else await expectError(response, 409, 'LEDGER_TOTAL_LIMIT_EXCEEDED');
          }
          await expectError(await fetch(endpoints[0]!, jsonRequest('POST', { ...input, type: 'income', categoryId: income, amount: 1 })), 409, 'LEDGER_TOTAL_LIMIT_EXCEEDED');
          await expectError(await fetch(`${endpoints[0]}/${winnerId}`, jsonRequest('PATCH', { amount: 2 })), 409, 'LEDGER_TOTAL_LIMIT_EXCEEDED');
          assert.equal((await fetch(`${endpoints[0]}/${winnerId}`, { method: 'DELETE' })).status, 204);
          assert.equal(await grossTotal(), limit - 1n);
          assert.equal((await fetch(endpoints[0]!, jsonRequest('POST', { ...input, amount: 1 }))).status, 201);

          await clearTransactions();
          const candidates = await Promise.all([0, 1].map(() => prisma.transaction.create({ data: {
            categoryId: expense, type: 'expense', amount: 1n, date: dateToPrisma('2026-11-14'), memo: '',
          } })));
          await fillTo(limit - 1n);
          const updates = await Promise.all(candidates.map((row, index) => fetch(`${endpoints[index]}/${row.id}`, jsonRequest('PATCH', { amount: 2 }))));
          assert.deepEqual(updates.map(response => response.status).sort(), [200, 409]);
          assert.equal(await grossTotal(), limit);
          for (const response of updates) if (response.status === 409) await expectError(response, 409, 'LEDGER_TOTAL_LIMIT_EXCEEDED');
          const current = await prisma.transaction.findMany({ where: { id: { in: candidates.map(row => row.id) } } });
          assert.deepEqual(current.map(row => row.amount).sort(), [1n, 2n]);
          const increased = current.find(row => row.amount === 2n)!;
          assert.equal((await fetch(`${endpoints[0]}/${increased.id}`, jsonRequest('PATCH', { amount: 1 }))).status, 200);
          assert.equal(await grossTotal(), limit - 1n);
        }));
      } finally {
        await clearTransactions();
      }
    });
  } finally {
    try {
      await clearTransactions();
      await prisma.category.deleteMany({ where: { id: { in: ownedCategories } } });
      assert.deepEqual(await fingerprintData(), before, '기존 Seed·거래·타임스탬프의 전체 해시가 같아야 합니다.');
      context.diagnostic(`기존 데이터 보존 확인: 카테고리 ${before.categories.count}개, 거래 ${before.transactions.count}개 (전체 행 SHA-256 일치)`);
    } finally {
      await prisma.$disconnect();
    }
  }
});
