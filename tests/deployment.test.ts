import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { databaseTarget, DeploymentInputError, productionConfirmation } from '../scripts/database-target.ts';
import { parseEnv } from '../src/config/env.ts';

const settings = {
  NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3004',
  DATABASE_URL: 'mysql://budget_app:hidden-password@127.0.0.1:3306/my_budget',
};

test('운영 초기화는 production과 정확한 대상 확인을 요구하고 기본 실행은 조회만 한다', () => {
  const environment = parseEnv(settings);
  assert.deepEqual(databaseTarget(environment), {
    environment: 'production', host: '127.0.0.1', port: 3306, database: 'my_budget', user: 'budget_app',
  });
  assert.equal(productionConfirmation(environment, []), undefined);
  assert.equal(productionConfirmation(environment, ['--confirm-target', '127.0.0.1:3306/my_budget']), '127.0.0.1:3306/my_budget');
  for (const args of [
    ['--confirm-target'], ['--yes'], ['--confirm-target', '127.0.0.1:3306/other'],
    ['--confirm-target', 'localhost:3306/my_budget'], ['--confirm-target', '127.0.0.1:3306/my_budget', 'extra'],
  ]) assert.throws(() => productionConfirmation(environment, args), DeploymentInputError);
  for (const NODE_ENV of ['development', 'test'] as const) {
    assert.throws(() => productionConfirmation({ ...environment, NODE_ENV }, []), DeploymentInputError);
  }
  assert.doesNotMatch(JSON.stringify(databaseTarget(environment)), /hidden-password|mysql:\/\//);
});

test('PM2는 프로젝트의 단일 프로세스와 .env를 사용하고 비밀정보를 설정에 넣지 않는다', () => {
  const require = createRequire(import.meta.url);
  const { apps } = require('../ecosystem.config.cjs');
  assert.equal(apps.length, 1);
  const app = apps[0];
  assert.equal(app.name, 'my-budget-backend');
  assert.equal(app.cwd, process.cwd());
  assert.equal(app.script, './dist/server.js');
  assert.equal(app.interpreter, process.execPath);
  assert.equal(app.exec_mode, 'fork');
  assert.equal(app.instances, 1);
  assert.equal(app.watch, false);
  assert.ok(app.kill_timeout > 10000);
  assert.deepEqual(app.env, { NODE_ENV: 'production' });
  for (const name of ['DATABASE_URL', 'ENV_FILE', 'HOST', 'PORT']) assert.ok(app.filter_env.includes(name));
  assert.doesNotMatch(JSON.stringify(apps), /mysql:\/\/|hidden-password/);
});

test('ENV_FILE은 별도 설정을 읽고 주입된 값을 우선하며 누락 파일은 명확하게 거부한다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'budget-env-'));
  const path = join(directory, '.env.migration');
  const source = { ...process.env };
  for (const key of ['NODE_ENV', 'HOST', 'PORT', 'DATABASE_URL', 'ENV_FILE']) delete source[key];
  const code = "const { env } = await import('./src/config/env.ts'); console.log(JSON.stringify({ mode: env.NODE_ENV, port: env.PORT, user: new URL(env.DATABASE_URL).username }));";
  const run = (overrides: NodeJS.ProcessEnv) => spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    cwd: process.cwd(), env: { ...source, ENV_FILE: path, ...overrides }, encoding: 'utf8', timeout: 10000,
  });
  try {
    writeFileSync(path, 'NODE_ENV=production\nHOST=127.0.0.1\nPORT=3004\nDATABASE_URL=mysql://budget_migrate:example-secret@127.0.0.1/my_budget\n', { mode: 0o600 });
    const loaded = run({});
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.deepEqual(JSON.parse(loaded.stdout), { mode: 'production', port: 3004, user: 'budget_migrate' });
    const injected = run({ PORT: '3005' });
    assert.equal(injected.status, 0, injected.stderr);
    assert.equal(JSON.parse(injected.stdout).port, 3005);
    for (const ENV_FILE of [join(directory, 'missing'), '  ']) {
      const invalid = run({ ...settings, ENV_FILE });
      assert.notEqual(invalid.status, 0);
      assert.match(invalid.stderr, /ENV_FILE:/);
      assert.doesNotMatch(invalid.stderr, /example-secret|hidden-password|mysql:\/\//);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('운영 초기화 대상 확인과 기존 개발 Seed 보호는 DB에 연결하기 전에 실패한다', () => {
  for (const [script, NODE_ENV, args, message] of [
    ['scripts/init-production-categories.ts', 'development', [], /NODE_ENV=production/],
    ['scripts/init-production-categories.ts', 'production', ['--confirm-target', 'wrong'], /확인 대상이/],
    ['prisma/seed.ts', 'production', [], /로컬 개발 DB에서만/],
  ] as const) {
    const environment: NodeJS.ProcessEnv = { ...process.env, ...settings, NODE_ENV,
      DATABASE_URL: 'mysql://budget:hidden-password@127.0.0.1:1/unused_dev' };
    delete environment.ENV_FILE;
    const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
      env: environment, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stderr, /hidden-password|mysql:\/\/|PrismaClient/);
    assert.equal(result.stdout, '');
  }
});
