import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { env } from '../../src/config/env.ts';
import { prisma } from '../../src/db/prisma.ts';
import { amountToBigInt, dateToPrisma, toTransactionDto } from '../../src/domain/ledger.ts';
import { seedCategories } from '../../prisma/seed-categories.ts';

test('로컬 개발 DB의 Seed, 외래키, CHECK, 트리거 및 DTO를 검증한다', async () => {
  const url = new URL(env.DATABASE_URL);
  assert.ok(['development', 'test'].includes(env.NODE_ENV));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /_(dev|test)$/);
  const rollback = new Error('검증 데이터를 모두 롤백합니다.');
  try {
    await assert.rejects(prisma.$transaction(async tx => {
      await seedCategories(tx);
      const categories = await tx.category.findMany({ orderBy: { id: 'asc' } });
      const transactionCount = await tx.transaction.count();
      await seedCategories(tx);
      assert.deepEqual(await tx.category.findMany({ orderBy: { id: 'asc' } }), categories);
      assert.equal(await tx.transaction.count(), transactionCount);

      const suffix = randomUUID().slice(0, 8);
      const expense = await tx.category.create({ data: {
        name: `QA-${suffix}`, type: 'expense', symbol: 'other',
      } });
      const income = await tx.category.create({ data: {
        name: expense.name, type: 'income', symbol: 'income',
      } });
      assert.equal(typeof expense.id, 'string');
      await assert.rejects(tx.category.create({ data: {
        name: expense.name.toLowerCase(), type: 'expense', symbol: 'other',
      } }));
      // 사용 중이지 않은 카테고리도 유형 변경이 금지되어야 합니다.
      await assert.rejects(tx.category.update({ where: { id: income.id }, data: { type: 'expense' } }));

      const data = {
        categoryId: expense.id, type: 'expense' as const,
        amount: amountToBigInt(999_999_999_999), date: dateToPrisma('2024-02-29'), memo: '검증',
      };
      const transaction = await tx.transaction.create({ data });
      assert.equal(toTransactionDto(transaction).date, '2024-02-29');
      assert.equal(toTransactionDto(transaction).amount, 999_999_999_999);
      await assert.rejects(tx.category.delete({ where: { id: expense.id } }));
      await assert.rejects(tx.transaction.create({ data: { ...data, type: 'income' } }));
      await assert.rejects(tx.transaction.create({ data: { ...data, categoryId: randomUUID() } }));
      await assert.rejects(tx.transaction.update({ where: { id: transaction.id }, data: { type: 'income' } }));
      for (const amount of [0n, -1n, 1_000_000_000_000n]) {
        await assert.rejects(tx.transaction.create({ data: { ...data, amount } }));
      }
      await assert.rejects(tx.transaction.create({ data: { ...data, date: new Date('1899-12-31T00:00:00Z') } }));
      await assert.rejects(tx.category.create({ data: { name: '', type: 'expense', symbol: 'other' } }));
      await assert.rejects(tx.category.create({ data: { name: '가'.repeat(21), type: 'expense', symbol: 'other' } }));
      await assert.rejects(tx.transaction.create({ data: { ...data, memo: '가'.repeat(101) } }));
      for (const date of ['1900-01-01', '9999-12-31']) {
        const row = await tx.transaction.create({ data: { ...data, amount: 1n, date: dateToPrisma(date) } });
        assert.equal(toTransactionDto(row).date, date);
      }
      await tx.transaction.delete({ where: { id: transaction.id } });
      await tx.category.delete({ where: { id: income.id } });
      throw rollback;
    }, { timeout: 20_000 }), error => error === rollback);
  } finally {
    await prisma.$disconnect();
  }
});
