import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { defaultCategories, seedCategories } from '../../prisma/seed-categories.ts';
import { testApp as createApp, authenticatedFetch as fetch } from '../helpers/auth.ts';
import { prisma } from '../../src/db/prisma.ts';
import { MAX_AMOUNT, dateToPrisma, type CategoryDto, type LedgerDataDto, type TransactionDto } from '../../src/domain/ledger.ts';
import type { Prisma } from '../../src/generated/prisma/client.ts';
import type { ErrorLog } from '../../src/middleware/errorHandler.ts';
import { createLedgerService } from '../../src/modules/ledger/ledger.service.ts';
import { assertLocalTestDatabase, fingerprintData } from '../helpers/database.ts';
import { jsonRequest, withServer } from '../helpers/http.ts';

async function readLedger(base: string): Promise<LedgerDataDto> {
  const response = await fetch(`${base}/api/v1/ledger`);
  assert.equal(response.status, 200);
  const ledger = await response.json() as LedgerDataDto;
  assert.deepEqual(Object.keys(ledger).sort(), ['categories', 'transactions', 'version']);
  assert.equal(ledger.version, 1);
  const categories = new Map(ledger.categories.map(category => {
    assert.deepEqual(Object.keys(category).sort(), ['id', 'name', 'symbol', 'type']);
    return [category.id, category];
  }));
  for (const row of ledger.transactions) {
    assert.deepEqual(Object.keys(row).sort(), ['amount', 'categoryId', 'date', 'id', 'memo', 'type']);
    assert.ok(Number.isSafeInteger(row.amount) && row.amount >= 1 && row.amount <= MAX_AMOUNT);
    assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(categories.get(row.categoryId)?.type, row.type, '모든 거래는 같은 스냅샷의 동일 유형 카테고리를 참조해야 합니다.');
  }
  return ledger;
}

// 롤백용 외부 트랜잭션의 실제 쿼리를 사용하며 중첩 트랜잭션은 만들지 않습니다.
function ledgerWithin(tx: Prisma.TransactionClient) {
  return createLedgerService({ async $transaction(read, options) {
    assert.equal(options.isolationLevel, 'RepeatableRead');
    return read(tx);
  } });
}

test('Ledger 전체 조회·CRUD 반영·스냅샷·합계를 실제 로컬 DB에서 검증하고 기존 데이터를 보존한다', async context => {
  assertLocalTestDatabase();
  const before = await fingerprintData();
  const prefix = `LD-${randomUUID().slice(0, 8)}`;
  const expense = `${prefix}-expense`;
  const otherExpense = `${prefix}-other`;
  const income = `${prefix}-income`;
  const snapshotOld = `${prefix}-snapshot`;
  const limitCategory = `${prefix}-limit`;
  const ownedIds = new Set([expense, otherExpense, income, snapshotOld, limitCategory]);
  const newCategoryName = `${prefix}-new`;
  assert.equal(await prisma.category.count({ where: { OR: [
    { id: { in: [...ownedIds] } }, { name: newCategoryName },
  ] } }), 0);
  const clearTransactions = () => prisma.transaction.deleteMany({ where: { categoryId: { in: [...ownedIds] } } });

  try {
    await context.test('기존 목록과 정렬이 같고 거래가 없어도 기본 카테고리 10개를 포함한다', async () => {
      await withServer(createApp(), async base => {
        const ledger = await readLedger(base);
        assert.deepEqual(ledger.categories, await (await fetch(`${base}/api/v1/categories`)).json());
        assert.deepEqual(ledger.transactions, await (await fetch(`${base}/api/v1/transactions`)).json());
        if (before.transactions.count === 0) assert.deepEqual(ledger.transactions, []);
        assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok' });
      });

      const rollback = new Error('기본 카테고리 조회 검증 롤백');
      await assert.rejects(prisma.$transaction(async tx => {
        await seedCategories(tx);
        await withServer(createApp({ ledgerService: ledgerWithin(tx) }), async base => {
          const ledger = await readLedger(base);
          const included = defaultCategories.map(seed => ledger.categories.find(category => category.id === seed.id)
            ?? ledger.categories.find(category => category.type === seed.type && category.name === seed.name));
          assert.ok(included.every(category => category !== undefined));
          assert.equal(new Set(included.map(category => category!.id)).size, 10);
          assert.equal(ledger.transactions.length, before.transactions.count);
          if (before.transactions.count === 0) assert.deepEqual(ledger.transactions, []);
        });
        throw rollback;
      }, { isolationLevel: 'RepeatableRead', timeout: 20_000 }), error => error === rollback);
    });

    await prisma.category.createMany({ data: [
      { id: expense, name: `${prefix}-A`, type: 'expense', symbol: 'food' },
      { id: otherExpense, name: `${prefix}-B`, type: 'expense', symbol: 'other' },
      { id: income, name: `${prefix}-A`, type: 'income', symbol: 'income' },
      { id: snapshotOld, name: `${prefix}-S`, type: 'expense', symbol: 'other' },
    ] });

    await context.test('추가·부분 수정·삭제·카테고리 이름 변경과 BIGINT/DATE DTO를 반영한다', async () => {
      try {
        await withServer(createApp(), async base => {
          const endpoint = `${base}/api/v1/transactions`;
          const created: TransactionDto[] = [];
          for (const [categoryId, type, amount, date] of [
            [expense, 'expense', MAX_AMOUNT, '2024-02-29'],
            [expense, 'expense', 1, '1900-01-01'],
            [expense, 'expense', 9000, '2026-11-14'],
            [income, 'income', 10000, '2026-11-14'],
          ] as const) {
            const response = await fetch(endpoint, jsonRequest('POST', { categoryId, type, amount, date, memo: '  검증  ' }));
            assert.equal(response.status, 201);
            const row = await response.json() as TransactionDto;
            created.push(row);
            const ledger = await readLedger(base);
            assert.deepEqual(ledger.transactions.find(value => value.id === row.id), { ...row, amount, date, memo: '검증' });
            assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } })).amount, BigInt(amount));
          }
          const ledger = await readLedger(base);
          assert.deepEqual(ledger.categories, await (await fetch(`${base}/api/v1/categories`)).json());
          assert.deepEqual(ledger.transactions, await (await fetch(endpoint)).json());
          assert.deepEqual(ledger.categories.filter(category => [expense, otherExpense, income].includes(category.id))
            .map(category => category.id), [expense, otherExpense, income]);
          const expected = [...created].sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id));
          assert.deepEqual(ledger.transactions.filter(row => created.some(value => value.id === row.id)), expected);

          const changed = await fetch(`${endpoint}/${created[1]!.id}`, jsonRequest('PATCH', {
            amount: MAX_AMOUNT, date: '9999-12-31', categoryId: otherExpense, memo: '  변경  ',
          }));
          assert.equal(changed.status, 200);
          const updated = await changed.json() as TransactionDto;
          assert.deepEqual((await readLedger(base)).transactions.find(row => row.id === updated.id), {
            ...created[1], amount: MAX_AMOUNT, date: '9999-12-31', categoryId: otherExpense, memo: '변경',
          });
          const renamed = await fetch(`${base}/api/v1/categories/${otherExpense}`, jsonRequest('PATCH', { name: `${prefix}-renamed` }));
          assert.equal(renamed.status, 200);
          const current = await readLedger(base);
          assert.deepEqual(current.categories.find(category => category.id === otherExpense), await renamed.json());
          assert.equal(current.transactions.find(row => row.id === updated.id)?.categoryId, otherExpense);
          assert.equal((await fetch(`${base}/api/v1/categories/${otherExpense}`, { method: 'DELETE' })).status, 409);
          assert.equal((await fetch(`${endpoint}/${updated.id}`)).status, 200);
          assert.equal((await fetch(`${endpoint}/${updated.id}`, { method: 'DELETE' })).status, 204);
          assert.ok(!(await readLedger(base)).transactions.some(row => row.id === updated.id));
        });
      } finally {
        await clearTransactions();
      }
    });

    await context.test('두 SELECT 사이에 쓰기가 커밋되어도 처음의 동일한 스냅샷을 읽으며 쓰기를 막지 않는다', async () => {
      const original = await prisma.transaction.create({ data: {
        categoryId: snapshotOld, type: 'expense', amount: 9000n, date: dateToPrisma('2026-11-14'), memo: '처음',
      } });
      const initial = await createLedgerService().get();
      let markRead!: () => void;
      let resumeRead!: () => void;
      const categoriesRead = new Promise<void>(resolve => { markRead = resolve; });
      const resume = new Promise<void>(resolve => { resumeRead = resolve; });
      let reads = 0;
      const service = createLedgerService({
        $transaction: (read, options) => prisma.$transaction(tx => {
          const category = new Proxy(tx.category, { get(target, property, receiver) {
            if (property !== 'findMany') return Reflect.get(target, property, receiver);
            return async (...args: Parameters<typeof tx.category.findMany>) => {
              const categories = await tx.category.findMany(...args);
              reads++;
              markRead();
              await resume;
              return categories;
            };
          } });
          return read(new Proxy(tx, { get(target, property, receiver) {
            return property === 'category' ? category : Reflect.get(target, property, receiver);
          } }));
        }, options),
      });

      try {
        await withServer(createApp({ ledgerService: service }), async base => {
          const pending = readLedger(base);
          try {
            await Promise.race([categoriesRead, pending.then(() => assert.fail('카테고리 SELECT 이후 거래 조회 전 대기해야 합니다.'))]);
            // 읽기를 재개하기 전에 별도 연결의 기존 CRUD 요청이 모두 커밋되어야 합니다.
            assert.equal((await fetch(`${base}/api/v1/categories/${snapshotOld}`, jsonRequest('PATCH', { name: `${prefix}-changed` }))).status, 200);
            assert.equal((await fetch(`${base}/api/v1/transactions/${original.id}`, jsonRequest('PATCH', { amount: 1, memo: '수정' }))).status, 200);
            const categoryResponse = await fetch(`${base}/api/v1/categories`, jsonRequest('POST', {
              name: newCategoryName, type: 'income', symbol: 'income',
            }));
            assert.equal(categoryResponse.status, 201);
            const category = await categoryResponse.json() as CategoryDto;
            ownedIds.add(category.id);
            const transactionResponse = await fetch(`${base}/api/v1/transactions`, jsonRequest('POST', {
              categoryId: category.id, type: 'income', amount: 1, date: '2026-11-15', memo: '새 거래',
            }));
            assert.equal(transactionResponse.status, 201);
            const added = await transactionResponse.json() as TransactionDto;
            assert.equal((await fetch(`${base}/api/v1/transactions/${original.id}`, { method: 'DELETE' })).status, 204);
            assert.equal((await fetch(`${base}/api/v1/categories/${snapshotOld}`, { method: 'DELETE' })).status, 204);

            const latest = await createLedgerService().get();
            assert.ok(latest.transactions.some(row => row.id === added.id));
            assert.ok(latest.categories.some(row => row.id === category.id));
            assert.ok(!latest.transactions.some(row => row.id === original.id));
            assert.ok(!latest.categories.some(row => row.id === snapshotOld));
            resumeRead();
            assert.deepEqual(await pending, initial, '중간 커밋이 섞이지 않은 첫 SELECT 시점의 전체 응답이어야 합니다.');
            assert.equal(reads, 1);
          } finally {
            resumeRead();
            await pending.catch(() => {});
          }
        });
      } finally {
        resumeRead();
        await clearTransactions();
      }
    });

    await context.test('실제 BIGINT 합계가 MAX_SAFE_INTEGER이면 성공하고 초과하면 내부 정보 없는 500이다', async () => {
      const rollback = new Error('합계 검증 데이터 롤백');
      const logs: ErrorLog[] = [];
      await assert.rejects(prisma.$transaction(async tx => {
        await tx.category.create({ data: { id: limitCategory, name: `${prefix}-limit`, type: 'expense', symbol: 'other' } });
        const total = (await tx.transaction.aggregate({ _sum: { amount: true } }))._sum.amount ?? 0n;
        let remaining = BigInt(Number.MAX_SAFE_INTEGER) - total;
        assert.ok(remaining >= 0n, '합계 한도 이하인 개발·테스트 DB가 필요합니다.');
        let sequence = 0;
        while (remaining > 0n) {
          const data = [];
          for (let index = 0; index < 500 && remaining > 0n; index++) {
            const amount = remaining > BigInt(MAX_AMOUNT) ? BigInt(MAX_AMOUNT) : remaining;
            remaining -= amount;
            data.push({ id: `${prefix}-limit-${sequence++}`, categoryId: limitCategory, type: 'expense' as const,
              amount, date: dateToPrisma('2026-11-14'), memo: '롤백할 합계 검증 데이터' });
          }
          await tx.transaction.createMany({ data });
        }
        await withServer(createApp({ ledgerService: ledgerWithin(tx), logger: entry => logs.push(entry) }), async base => {
          const ledger = await readLedger(base);
          assert.equal(ledger.transactions.reduce((sum, row) => sum + BigInt(row.amount), 0n), BigInt(Number.MAX_SAFE_INTEGER));
          await tx.transaction.create({ data: {
            categoryId: limitCategory, type: 'expense', amount: 1n, date: dateToPrisma('2026-11-14'), memo: '한도 초과',
          } });
          const response = await fetch(`${base}/api/v1/ledger`);
          assert.equal(response.status, 500);
          assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: '서버 오류가 발생했습니다.' } });
          assert.equal(logs.length, 1);
          assert.equal(logs[0]?.requestId, response.headers.get('x-request-id'));
          assert.doesNotMatch(JSON.stringify(logs), /초과|900719925474099|SELECT|mysql:\/\//);
        });
        throw rollback;
      }, { isolationLevel: 'RepeatableRead', timeout: 30_000 }), error => error === rollback);
    });
  } finally {
    try {
      // 생성 응답 처리 중 실패한 경우에도 미사용 확인한 전용 이름으로 자신의 행만 찾습니다.
      const added = await prisma.category.findMany({ where: { name: newCategoryName } });
      for (const category of added) ownedIds.add(category.id);
      await clearTransactions();
      await prisma.category.deleteMany({ where: { id: { in: [...ownedIds] } } });
      assert.deepEqual(await fingerprintData(), before, '기존 Seed·거래·타임스탬프의 전체 해시가 같아야 합니다.');
      context.diagnostic(`기존 데이터 보존 확인: 카테고리 ${before.categories.count}개, 거래 ${before.transactions.count}개 (전체 행 SHA-256 일치)`);
    } finally {
      await prisma.$disconnect();
    }
  }
});
