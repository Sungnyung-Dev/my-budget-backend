import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_AMOUNT, amountToBigInt, amountToNumber, dateToPrisma, dateToString,
  normalizeCategoryName, normalizeMemo, toLedgerDto, toTransactionDto,
} from '../src/domain/ledger.ts';
import type { Transaction } from '../src/generated/prisma/client.ts';

test('금액 경계값을 손실 없이 변환하고 잘못된 금액을 거부한다', () => {
  for (const amount of [1, MAX_AMOUNT]) assert.equal(amountToNumber(amountToBigInt(amount)), amount);
  for (const amount of [0, -1, 1.5, NaN, Infinity, MAX_AMOUNT + 1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => amountToBigInt(amount), RangeError);
  }
  for (const amount of [0n, -1n, BigInt(MAX_AMOUNT) + 1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n]) {
    assert.throws(() => amountToNumber(amount), RangeError);
  }
});

test('윤년과 프론트엔드 날짜 범위를 검증하고 UTC로 왕복한다', () => {
  for (const date of ['1900-01-01', '2024-02-29', '2026-11-14', '9999-12-31']) {
    assert.equal(dateToString(dateToPrisma(date)), date);
    assert.equal(dateToPrisma(date).getUTCHours(), 0);
  }
  for (const date of ['1899-12-31', '1900-02-29', '2025-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '0000-01-01']) {
    assert.throws(() => dateToPrisma(date), RangeError);
  }
  assert.throws(() => dateToString(new Date('invalid')), RangeError);
});

test('이름과 메모는 iOS와 같은 trim 및 UTF-16 길이 규칙을 사용한다', () => {
  assert.equal(normalizeCategoryName(' 식비 '), '식비');
  assert.equal(normalizeCategoryName('가'.repeat(20)).length, 20);
  assert.equal(normalizeMemo(' 메모 '), '메모');
  assert.equal(normalizeMemo('가'.repeat(100)).length, 100);
  for (const name of [' ', '가'.repeat(21), '😀'.repeat(11)]) assert.throws(() => normalizeCategoryName(name));
  assert.throws(() => normalizeMemo('가'.repeat(101)));
});

const transaction: Transaction = {
  id: 'string-id', categoryId: 'food', type: 'expense', amount: BigInt(MAX_AMOUNT),
  date: dateToPrisma('2026-11-14'), memo: '', createdAt: new Date(), updatedAt: new Date(),
};

test('DTO는 문자열 ID, 숫자 금액, YYYY-MM-DD를 가진 JSON을 반환한다', () => {
  const dto = toTransactionDto(transaction);
  assert.deepEqual(JSON.parse(JSON.stringify(dto)), {
    id: 'string-id', categoryId: 'food', type: 'expense', amount: MAX_AMOUNT,
    date: '2026-11-14', memo: '',
  });
  assert.equal(toLedgerDto([], [transaction]).version, 1);
});

test('전체 금액의 합이 iOS 안전 정수 범위를 넘으면 DTO 생성을 거부한다', () => {
  assert.throws(() => toLedgerDto([], Array.from({ length: 9008 }, () => transaction)), RangeError);
});
