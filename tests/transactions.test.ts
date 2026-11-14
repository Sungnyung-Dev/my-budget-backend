import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/db/prisma.ts';
import { assertLedgerTotal, dateToPrisma, toTransactionDto } from '../src/domain/ledger.ts';
import { Prisma, type Transaction } from '../src/generated/prisma/client.ts';
import { ApiError, type ErrorLog } from '../src/middleware/errorHandler.ts';
import { createTransactionsService, type TransactionsDatabase, type TransactionsService } from '../src/modules/transactions/transactions.service.ts';
import type { CreateTransactionInput, TransactionsQuery, UpdateTransactionInput } from '../src/modules/transactions/transactions.validation.ts';
import { jsonRequest, withServer } from './helpers/http.ts';

const valid = { type: 'expense', amount: 9000, categoryId: 'food', date: '2026-11-14', memo: '점심' };
const row: Transaction = {
  ...valid, id: 'string-id', type: 'expense', amount: 9000n, date: dateToPrisma(valid.date),
  createdAt: new Date(), updatedAt: new Date(),
};

function stubService(): TransactionsService {
  return {
    list: async () => [toTransactionDto(row)],
    get: async id => toTransactionDto({ ...row, id }),
    create: async input => toTransactionDto({ ...row, ...input }),
    update: async (id, input) => toTransactionDto({ ...row, ...input, id }),
    remove: async () => {},
  };
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
  assert.match(response.headers.get('x-request-id') ?? '', /^[\da-f-]{36}$/);
}

test('거래 라우트는 검증된 bigint·UTC 날짜·정규화된 메모 및 부분 수정만 전달한다', async () => {
  const service = stubService();
  const queries: TransactionsQuery[] = [];
  const creates: CreateTransactionInput[] = [];
  const updates: UpdateTransactionInput[] = [];
  service.list = async query => { queries.push(query ?? {}); return [toTransactionDto(row)]; };
  service.create = async input => { creates.push(input); return toTransactionDto({ ...row, ...input }); };
  service.update = async (id, input) => { updates.push(input); return toTransactionDto({ ...row, ...input, id }); };
  await withServer(createApp({ transactionsService: service }), async url => {
    const endpoint = `${url}/api/v1/transactions`;
    for (const query of ['', '?from=2026-11-14', '?to=2026-11-15', '?from=2026-11-14&to=2026-11-14']) {
      const response = await fetch(`${endpoint}${query}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), [toTransactionDto(row)]);
    }
    assert.deepEqual(queries[0], {});
    assert.equal(queries[1]?.from?.toISOString(), '2026-11-14T00:00:00.000Z');
    assert.equal(queries[2]?.to?.toISOString(), '2026-11-15T00:00:00.000Z');
    const get = await fetch(`${endpoint}/string-id`);
    assert.equal(get.status, 200);
    assert.deepEqual(await get.json(), toTransactionDto(row));
    for (const amount of [1, 999_999_999_999]) {
      const response = await fetch(endpoint, jsonRequest('POST', { ...valid, amount, memo: '  점심  ' }));
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { ...toTransactionDto(row), amount });
    }
    assert.deepEqual(creates.map(input => input.amount), [1n, 999_999_999_999n]);
    assert.equal(creates[0]?.memo, '점심');
    for (const date of ['1900-01-01', '2024-02-29', '9999-12-31']) {
      assert.equal((await fetch(endpoint, jsonRequest('POST', { ...valid, date, memo: '😀'.repeat(50) }))).status, 201);
    }
    const updated = await fetch(`${endpoint}/string-id`, jsonRequest('PATCH', { memo: '  변경  ' }));
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), { ...toTransactionDto(row), memo: '변경' });
    assert.deepEqual(updates, [{ memo: '변경' }]);
    const deleted = await fetch(`${endpoint}/string-id`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), '');
  });
});

test('거래 입력·기간·ID·알 수 없는 필드는 서비스 호출 전 400으로 거부한다', async () => {
  let calls = 0;
  const invoked = () => { calls++; throw new Error('잘못된 요청이 서비스에 전달되었습니다.'); };
  const service: TransactionsService = { list: invoked, get: invoked, create: invoked, update: invoked, remove: invoked };
  await withServer(createApp({ transactionsService: service }), async url => {
    const endpoint = `${url}/api/v1/transactions`;
    for (const patch of [
      { amount: 0 }, { amount: -1 }, { amount: 1.5 }, { amount: 1_000_000_000_000 },
      { amount: Number.MAX_SAFE_INTEGER + 1 }, { amount: '9000' }, { amount: null },
      { date: '2026-02-29' }, { date: '1900-02-29' }, { date: '2026-04-31' }, { date: '2026-13-01' },
      { date: '2026-1-01' }, { date: '2026-11-14T00:00:00Z' }, { date: '1899-12-31' },
      { type: 'transfer' }, { categoryId: '' }, { categoryId: 1 }, { categoryId: 'a'.repeat(192) },
      { memo: '가'.repeat(101) }, { memo: '😀'.repeat(51) }, { memo: null }, { id: 'client-id' },
    ]) {
      await expectError(await fetch(endpoint, jsonRequest('POST', { ...valid, ...patch })), 400, 'INVALID_REQUEST');
      await expectError(await fetch(`${endpoint}/id`, jsonRequest('PATCH', patch)), 400, 'INVALID_REQUEST');
    }
    for (const body of [null, [], {}, { ...valid, memo: undefined }, { ...valid, amount: undefined }]) {
      await expectError(await fetch(endpoint, jsonRequest('POST', body)), 400, 'INVALID_REQUEST');
    }
    await expectError(await fetch(`${endpoint}/id`, jsonRequest('PATCH', {})), 400, 'INVALID_REQUEST');
    for (const query of [
      '?from=', '?from=2026-02-29', '?to=2026-13-01', '?from=2026-11-15&to=2026-11-14',
      '?from=2026-11-14&from=2026-11-15', '?from[]=2026-11-14', '?type=expense', '?unknown=x',
    ]) await expectError(await fetch(`${endpoint}${query}`), 400, 'INVALID_REQUEST');
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const options = method === 'PATCH' ? jsonRequest(method, { amount: 1 }) : { method };
      await expectError(await fetch(`${endpoint}/${'a'.repeat(192)}`, options), 400, 'INVALID_REQUEST');
      await expectError(await fetch(`${endpoint}/id?from=2026-11-14`, options), 400, 'INVALID_REQUEST');
    }
    await expectError(await fetch(`${endpoint}?unknown=x`, jsonRequest('POST', valid)), 400, 'INVALID_REQUEST');
    await expectError(await fetch(endpoint, { method: 'POST', body: JSON.stringify(valid) }), 400, 'INVALID_REQUEST');
    await expectError(await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }), 400, 'INVALID_REQUEST');
    await expectError(await fetch(`${endpoint}/id`, jsonRequest('DELETE', {})), 400, 'INVALID_REQUEST');
    await expectError(await fetch(`${endpoint}/id`, { method: 'DELETE', body: 'unexpected' }), 400, 'INVALID_REQUEST');
    await expectError(await fetch(`${endpoint}/%E0%A4%A`, { method: 'DELETE' }), 400, 'INVALID_REQUEST');
    assert.equal(calls, 0);
  });
});

test('Prisma 거래 오류를 안전한 400·404·409로 변환하고 P2034 재시도를 제한한다', async () => {
  for (const [prismaCode, status, code, attempts] of [
    ['P2003', 400, 'INVALID_CATEGORY', 1], ['P2025', 404, 'TRANSACTION_NOT_FOUND', 1],
    ['P2000', 400, 'INVALID_REQUEST', 1], ['P2004', 400, 'INVALID_REQUEST', 1],
    ['P2002', 409, 'TRANSACTION_CONFLICT', 1], ['P2034', 409, 'TRANSACTION_WRITE_CONFLICT', 3],
  ] as const) {
    let calls = 0;
    const database: TransactionsDatabase = {
      transaction: prisma.transaction,
      async $transaction(_run, options) {
        assert.equal(options.isolationLevel, 'Serializable');
        calls++;
        throw new Prisma.PrismaClientKnownRequestError('sensitive SQL mysql://user:hidden-password@host/db', {
          code: prismaCode, clientVersion: '7.10.1',
        });
      },
    };
    await withServer(createApp({ transactionsService: createTransactionsService(database) }), async url => {
      await expectError(await fetch(`${url}/api/v1/transactions`, jsonRequest('POST', valid)), status, code);
    });
    assert.equal(calls, attempts);
  }
});

test('재시도는 실패한 트랜잭션 전체를 다시 실행하고 이후 도메인 오류는 재시도하지 않는다', async () => {
  let attempts = 0;
  const database: TransactionsDatabase = {
    transaction: prisma.transaction,
    async $transaction() {
      attempts++;
      if (attempts < 3) throw new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '7.10.1' });
      throw new ApiError(404, 'TRANSACTION_NOT_FOUND', '거래를 찾을 수 없습니다.');
    },
  };
  await withServer(createApp({ transactionsService: createTransactionsService(database) }), async url => {
    await expectError(await fetch(`${url}/api/v1/transactions/id`, jsonRequest('PATCH', { memo: '수정' })), 404, 'TRANSACTION_NOT_FOUND');
  });
  assert.equal(attempts, 3);
});

test('거래의 예상하지 못한 오류는 안전한 500과 요청 ID를 기록한다', async () => {
  const service = stubService();
  service.update = async () => { throw new Error('mysql://private-user:hidden-password@host/db SELECT * FROM secrets'); };
  const logs: ErrorLog[] = [];
  await withServer(createApp({ transactionsService: service, logger: entry => logs.push(entry) }), async url => {
    const response = await fetch(`${url}/api/v1/transactions/private-id`, jsonRequest('PATCH', { memo: '정상' }));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: '서버 오류가 발생했습니다.' } });
    assert.equal(logs[0]?.requestId, response.headers.get('x-request-id'));
    assert.equal(logs[0]?.route, '/api/v1/transactions/:id');
    assert.doesNotMatch(JSON.stringify(logs), /private-id|private-user|hidden-password|SELECT|secrets/);
  });
});

test('Ledger 합계의 안전 정수 경계값은 DTO와 같은 도메인 검증을 사용한다', () => {
  assert.doesNotThrow(() => assertLedgerTotal(BigInt(Number.MAX_SAFE_INTEGER)));
  assert.throws(() => assertLedgerTotal(BigInt(Number.MAX_SAFE_INTEGER) + 1n), RangeError);
});
