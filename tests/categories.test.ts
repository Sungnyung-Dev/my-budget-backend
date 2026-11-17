import assert from 'node:assert/strict';
import test from 'node:test';
import { testApp as createApp, authenticatedFetch as fetch } from './helpers/auth.ts';
import { prisma } from '../src/db/prisma.ts';
import type { CategoryDto } from '../src/domain/ledger.ts';
import { Prisma } from '../src/generated/prisma/client.ts';
import type { ErrorLog } from '../src/middleware/errorHandler.ts';
import { createCategoriesService, type CategoriesDatabase, type CategoriesService } from '../src/modules/categories/categories.service.ts';
import { withServer, jsonRequest } from './helpers/http.ts';

const category: CategoryDto = { id: 'test-id', name: '테스트', type: 'expense', symbol: 'other' };

function stubService(): CategoriesService {
  return {
    list: async () => [category],
    create: async input => ({ ...input, id: category.id }),
    rename: async (id, input) => ({ ...category, ...input, id }),
    remove: async () => {},
  };
}

async function assertError(response: Response, status: number, code: string): Promise<void> {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  assert.match(response.headers.get('x-request-id') ?? '', /^[\da-f-]{36}$/);
}

test('HTTP 경계에서 필터·정규화·ID와 DTO 형식을 서비스에 전달한다', async () => {
  const service = stubService();
  const filters: unknown[] = [];
  service.list = async type => { filters.push(type); return [category]; };
  await withServer(createApp({ categoriesService: service }), async url => {
    for (const query of ['', '?type=expense', '?type=income']) {
      const response = await fetch(`${url}/api/v1/categories${query}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), [category]);
    }
    assert.deepEqual(filters, [undefined, 'expense', 'income']);
    for (const name of ['  새 이름  ', '가'.repeat(20), '😀'.repeat(10)]) {
      const response = await fetch(`${url}/api/v1/categories`, jsonRequest('POST', {
        name, type: 'expense', symbol: 'other',
      }));
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { id: category.id, name: name.trim(), type: 'expense', symbol: 'other' });
    }
    const renamed = await fetch(`${url}/api/v1/categories/string-id`, jsonRequest('PATCH', { name: '  변경  ' }));
    assert.equal(renamed.status, 200);
    assert.deepEqual(await renamed.json(), { ...category, id: 'string-id', name: '변경' });
    const deleted = await fetch(`${url}/api/v1/categories/string-id`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), '');
  });
});

test('잘못된 본문·쿼리·ID는 DB 호출 전에 400으로 거부한다', async () => {
  let calls = 0;
  const invoked = () => { calls++; throw new Error('검증 실패 요청이 서비스에 도달했습니다.'); };
  const service: CategoriesService = { list: invoked, create: invoked, rename: invoked, remove: invoked };
  await withServer(createApp({ categoriesService: service }), async url => {
    const valid = { name: '테스트', type: 'expense', symbol: 'other' };
    for (const body of [
      null, [], {}, { ...valid, name: null }, { ...valid, name: 1 }, { ...valid, name: '' },
      { ...valid, name: ' \n\t ' }, { ...valid, name: '가'.repeat(21) }, { ...valid, name: '😀'.repeat(11) },
      { ...valid, type: 'transfer' }, { ...valid, type: 'Expense' }, { ...valid, symbol: 'unknown' },
      { ...valid, id: 'client-id' }, { ...valid, createdAt: '2026-11-14' },
    ]) {
      await assertError(await fetch(`${url}/api/v1/categories`, jsonRequest('POST', body)), 400, 'INVALID_REQUEST');
    }
    for (const body of [
      {}, { name: '' }, { name: '가'.repeat(21) }, { name: '변경', type: 'income' },
      { name: '변경', symbol: 'food' }, { name: '변경', id: 'changed' },
    ]) {
      await assertError(await fetch(`${url}/api/v1/categories/id`, jsonRequest('PATCH', body)), 400, 'INVALID_REQUEST');
    }
    for (const query of ['?type=', '?type=transfer', '?type=expense&type=income', '?type[]=expense', '?unknown=value']) {
      await assertError(await fetch(`${url}/api/v1/categories${query}`), 400, 'INVALID_REQUEST');
    }
    await assertError(await fetch(`${url}/api/v1/categories?type=expense`, jsonRequest('POST', valid)), 400, 'INVALID_REQUEST');
    for (const method of ['PATCH', 'DELETE']) {
      await assertError(await fetch(`${url}/api/v1/categories/${'a'.repeat(192)}`,
        method === 'PATCH' ? jsonRequest(method, { name: '변경' }) : { method }), 400, 'INVALID_REQUEST');
      await assertError(await fetch(`${url}/api/v1/categories/id?unknown=value`,
        method === 'PATCH' ? jsonRequest(method, { name: '변경' }) : { method }), 400, 'INVALID_REQUEST');
    }
    await assertError(await fetch(`${url}/api/v1/categories/id`, jsonRequest('DELETE', {})), 400, 'INVALID_REQUEST');
    await assertError(await fetch(`${url}/api/v1/categories/id`, { method: 'DELETE', body: 'unexpected' }), 400, 'INVALID_REQUEST');
    await assertError(await fetch(`${url}/api/v1/categories/%E0%A4%A`, { method: 'DELETE' }), 400, 'INVALID_REQUEST');
    assert.equal(calls, 0);
  });
});

test('깨진 JSON, 누락·잘못된 Content-Type, 큰 본문, 미지원 인코딩은 공통 400 응답이다', async () => {
  await withServer(createApp({ categoriesService: stubService() }), async url => {
    const requests: RequestInit[] = [
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":' },
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '1' },
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { method: 'POST', body: '{"name":"text"}' },
      { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' },
      jsonRequest('POST', { name: '가'.repeat(20_000), type: 'expense', symbol: 'other' }),
      { method: 'POST', headers: { 'Content-Type': 'application/json; charset=ascii' }, body: '{}' },
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'unknown' }, body: '{}' },
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: 'broken gzip' },
    ];
    for (const options of requests) {
      await assertError(await fetch(`${url}/api/v1/categories`, options), 400, 'INVALID_REQUEST');
    }
    await assertError(await fetch(`${url}/api/v1/missing`), 404, 'API_NOT_FOUND');
    await assertError(await fetch(`${url}/api/v1/categories`, { method: 'PUT' }), 404, 'API_NOT_FOUND');
  });
});

test('Prisma 중복·외래키·대상 없음 오류를 카테고리 오류로 변환한다', async () => {
  for (const [method, prismaCode, status, code] of [
    ['POST', 'P2002', 409, 'CATEGORY_NAME_CONFLICT'],
    ['PATCH', 'P2002', 409, 'CATEGORY_NAME_CONFLICT'],
    ['PATCH', 'P2025', 404, 'CATEGORY_NOT_FOUND'],
    ['DELETE', 'P2025', 404, 'CATEGORY_NOT_FOUND'],
    ['DELETE', 'P2003', 409, 'CATEGORY_IN_USE'],
  ] as const) {
    const fail = () => {
      throw new Prisma.PrismaClientKnownRequestError('sensitive SQL mysql://user:password@host/db', {
        code: prismaCode, clientVersion: '7.10.1', meta: { password: 'hidden-password' },
      });
    };
    const database: CategoriesDatabase = { category: { ...prisma.category, create: fail, update: fail, deleteMany: fail } };
    const logs: ErrorLog[] = [];
    await withServer(createApp({ categoriesService: createCategoriesService(database), logger: entry => logs.push(entry) }), async url => {
      const path = method === 'POST' ? '/api/v1/categories' : '/api/v1/categories/id';
      const options = method === 'DELETE' ? { method } : jsonRequest(method, method === 'POST'
        ? { name: '테스트', type: 'expense', symbol: 'other' } : { name: '변경' });
      const response = await fetch(`${url}${path}`, options);
      await assertError(response, status, code);
      assert.equal(logs.length, 0);
    });
  }
});

test('예상하지 못한 오류의 응답과 로그에 인증정보·SQL·원본 메시지가 노출되지 않는다', async () => {
  for (const error of [
    new Error('mysql://private-user:hidden-password@private-host/private-db SELECT * FROM secrets Authorization=token'),
    new Prisma.PrismaClientKnownRequestError('SELECT password FROM secret', {
      code: 'P1001', clientVersion: '7.10.1', meta: { databaseUrl: 'mysql://user:hidden-password@host/db' },
    }),
    new SyntaxError('internal sensitive SQL'),
    { password: 'hidden-password', status: 400 },
  ]) {
    const service = stubService();
    service.list = async () => { throw error; };
    const logs: ErrorLog[] = [];
    await withServer(createApp({ categoriesService: service, logger: entry => logs.push(entry) }), async url => {
      const response = await fetch(`${url}/api/v1/categories`, {
        headers: { Authorization: 'Bearer hidden-password', Cookie: 'auth=hidden-password', 'X-Request-Id': 'untrusted' },
      });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: { code: 'INTERNAL_SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0]?.requestId, response.headers.get('x-request-id'));
      assert.equal(logs[0]?.method, 'GET');
      assert.equal(logs[0]?.route, '/api/v1/categories/');
      assert.doesNotMatch(JSON.stringify(logs), /private-user|hidden-password|private-host|private-db|SELECT|Authorization|token|secret|untrusted/);
      if (error instanceof Prisma.PrismaClientKnownRequestError) assert.equal(logs[0]?.prismaCode, 'P1001');
    });
  }
});
