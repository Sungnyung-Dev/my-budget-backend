import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';
import { testApp as createApp, authenticatedFetch as fetch, authenticatedHeaders } from './helpers/auth.ts';
import { MAX_AMOUNT, dateToPrisma, toLedgerDto } from '../src/domain/ledger.ts';
import { Prisma, type Category, type Transaction } from '../src/generated/prisma/client.ts';
import type { ErrorLog } from '../src/middleware/errorHandler.ts';
import { createLedgerService, type LedgerDatabase } from '../src/modules/ledger/ledger.service.ts';
import { withServer } from './helpers/http.ts';

const timestamp = new Date('2026-11-14T00:00:00.000Z');
const category: Category = {
  id: 'food', name: '식비', type: 'expense', symbol: 'food', createdAt: timestamp, updatedAt: timestamp,
};
const transaction: Transaction = {
  id: 'string-id', categoryId: 'food', type: 'expense', amount: 9000n,
  date: dateToPrisma('2026-11-14'), memo: '점심', createdAt: timestamp, updatedAt: timestamp,
};

test('Ledger는 빈 배열 및 version 1의 프론트엔드 DTO만 JSON으로 반환한다', async () => {
  for (const transactions of [[], [transaction]]) {
    const categories = transactions.length ? [category] : [];
    await withServer(createApp({ ledgerService: { get: async () => toLedgerDto(categories, transactions) } }), async base => {
      const response = await fetch(`${base}/api/v1/ledger`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /application\/json/);
      assert.match(response.headers.get('x-request-id') ?? '', /^[\da-f-]{36}$/);
      assert.deepEqual(await response.json(), {
        version: 1,
        categories: categories.map(({ id, name, type, symbol }) => ({ id, name, type, symbol })),
        transactions: transactions.map(({ id, categoryId, type, memo }) => ({
          id, categoryId, type, memo, amount: 9000, date: '2026-11-14',
        })),
      });
    });
  }
});

test('Ledger 쿼리와 모든 형식의 GET 본문은 서비스 호출 전에 400으로 거부한다', async () => {
  let calls = 0;
  await withServer(createApp({ ledgerService: { get: async () => {
    calls++;
    throw new Error('잘못된 요청이 서비스에 전달되었습니다.');
  } } }), async base => {
    const endpoint = `${base}/api/v1/ledger`;
    for (const query of ['?from=2026-11-14', '?type=expense', '?version=1', '?unknown=', '?x=1&x=2', '?x[]=1']) {
      const response = await fetch(`${endpoint}${query}`);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'INVALID_REQUEST');
    }
    // fetch는 GET 본문을 지원하지 않으므로 실제 HTTP 요청으로 경계를 검증합니다.
    for (const [contentType, body, chunked] of [
      ['application/json', '{}', false], ['application/json', '[]', false],
      ['application/json', 'null', false], ['application/json', '{', false],
      ['text/plain', 'unexpected', false], [undefined, 'unexpected', false],
      ['application/json', '{}', true], [undefined, '', true],
    ] as const) {
      await new Promise<void>((resolve, reject) => {
        const headers = {
          ...authenticatedHeaders,
          ...(contentType ? { 'Content-Type': contentType } : {}),
          ...(chunked ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': Buffer.byteLength(body) }),
        };
        const sent = request(endpoint, { method: 'GET', headers }, response => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => {
            try {
              assert.equal(response.statusCode, 400);
              assert.deepEqual(Object.keys(JSON.parse(Buffer.concat(chunks).toString())), ['error']);
              assert.equal(JSON.parse(Buffer.concat(chunks).toString()).error.code, 'INVALID_REQUEST');
              assert.match(String(response.headers['x-request-id']), /^[\da-f-]{36}$/);
              resolve();
            } catch (error) { reject(error); }
          });
        });
        sent.on('error', reject);
        sent.end(body);
      });
    }
    assert.equal(calls, 0);
  });
});

test('Ledger DB 오류는 RepeatableRead 조회에서 공통 안전한 500과 요청 ID로 처리한다', async () => {
  for (const error of [
    new Error('mysql://private-user:hidden-password@private-host/private-db SELECT * FROM secrets'),
    new Prisma.PrismaClientKnownRequestError('SELECT * FROM secrets', {
      code: 'P1001', clientVersion: '7.10.1', meta: { password: 'hidden-password' },
    }),
  ]) {
    let attempts = 0;
    const database: LedgerDatabase = { async $transaction(_read, options) {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      attempts++;
      throw error;
    } };
    const logs: ErrorLog[] = [];
    await withServer(createApp({ ledgerService: createLedgerService(database), logger: entry => logs.push(entry) }), async base => {
      const response = await fetch(`${base}/api/v1/ledger`, {
        headers: { Authorization: 'Bearer hidden-password', Cookie: 'auth=hidden-password', 'X-Request-Id': 'untrusted' },
      });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: '서버 오류가 발생했습니다.' } });
      assert.equal(logs.length, 1);
      assert.equal(logs[0]?.requestId, response.headers.get('x-request-id'));
      assert.equal(logs[0]?.method, 'GET');
      assert.equal(logs[0]?.route, '/api/v1/ledger/');
      if (error instanceof Prisma.PrismaClientKnownRequestError) assert.equal(logs[0]?.prismaCode, 'P1001');
      assert.doesNotMatch(JSON.stringify(logs), /private-user|hidden-password|private-host|private-db|SELECT|secrets|untrusted/);
    });
    assert.equal(attempts, 1);
  }
});

test('저장 금액·날짜 또는 전체 합계가 잘못되면 DTO 원문 없이 안전한 500을 반환한다', async () => {
  const logs: ErrorLog[] = [];
  for (const transactions of [
    [{ ...transaction, amount: 0n }],
    [{ ...transaction, amount: BigInt(MAX_AMOUNT) + 1n }],
    [{ ...transaction, amount: BigInt(Number.MAX_SAFE_INTEGER) + 1n }],
    [{ ...transaction, date: new Date('invalid') }],
    Array.from({ length: 9008 }, (_, index) => ({ ...transaction, id: `limit-${index}`, amount: BigInt(MAX_AMOUNT) })),
  ]) {
    await withServer(createApp({
      ledgerService: { get: async () => toLedgerDto([category], transactions) }, logger: entry => logs.push(entry),
    }), async base => {
      const response = await fetch(`${base}/api/v1/ledger`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: '서버 오류가 발생했습니다.' } });
      assert.equal(logs.at(-1)?.requestId, response.headers.get('x-request-id'));
    });
  }
  assert.equal(logs.length, 5);
  assert.doesNotMatch(JSON.stringify(logs), /RangeError|초과|저장 금액|저장 날짜|900719925474099/);
});
