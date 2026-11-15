import type { Environment } from '../src/config/env.ts';
import type { Prisma } from '../src/generated/prisma/client.ts';

export class DeploymentInputError extends Error {}

export function databaseTarget(environment: Environment) {
  const url = new URL(environment.DATABASE_URL);
  return {
    environment: environment.NODE_ENV,
    host: url.hostname,
    port: Number(url.port || 3306),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
  };
}

export function productionConfirmation(environment: Environment, args: string[]): string | undefined {
  if (environment.NODE_ENV !== 'production') {
    throw new DeploymentInputError('운영 초기화는 NODE_ENV=production에서만 실행할 수 있습니다.');
  }
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--confirm-target')) {
    throw new DeploymentInputError('사용법: db:init:production [--confirm-target host:port/database]');
  }
  const target = databaseTarget(environment);
  const expected = `${target.host}:${target.port}/${target.database}`;
  if (args.length && args[1] !== expected) {
    throw new DeploymentInputError('확인 대상이 DATABASE_URL과 다릅니다. 변경 없이 종료합니다.');
  }
  return args.length ? expected : undefined;
}

export async function inspectDatabase(client: Pick<Prisma.TransactionClient, '$queryRaw'>, environment: Environment) {
  const [actual] = await client.$queryRaw<{
    database: string | null; account: string; server: string; port: bigint; version: string;
  }[]>`SELECT DATABASE() AS \`database\`, CURRENT_USER() AS account, @@hostname AS server,
    @@port AS port, VERSION() AS version`;
  if (!actual || actual.database !== databaseTarget(environment).database) {
    throw new DeploymentInputError('실제 연결된 DB 이름이 설정과 다릅니다. 변경 없이 종료합니다.');
  }
  return { configured: databaseTarget(environment), connected: { ...actual, port: Number(actual.port) } };
}
