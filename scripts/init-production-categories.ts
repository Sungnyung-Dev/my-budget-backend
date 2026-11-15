import { CategorySeedConflict, seedCategories } from '../prisma/seed-categories.ts';
import { env } from '../src/config/env.ts';
import { prisma } from '../src/db/prisma.ts';
import { Prisma } from '../src/generated/prisma/client.ts';
import { DeploymentInputError, databaseTarget, inspectDatabase, productionConfirmation } from './database-target.ts';

try {
  const confirmed = productionConfirmation(env, process.argv.slice(2));
  console.info(JSON.stringify(await inspectDatabase(prisma, env), null, 2));
  if (!confirmed) {
    const target = databaseTarget(env);
    console.info(`조회만 완료했습니다. 초기화하려면 --confirm-target ${target.host}:${target.port}/${target.database}를 지정하세요.`);
  } else {
    const result = await prisma.$transaction(tx => seedCategories(tx, { strict: true }), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 10000,
    });
    console.info(`운영 기본 카테고리 초기화 완료: 생성 ${result.created}개, 기존 보존 ${result.preserved}개 (거래 변경 없음).`);
  }
} catch (error) {
  console.error(error instanceof CategorySeedConflict || error instanceof DeploymentInputError
    ? error.message : '운영 초기화 실패: DB 연결·마이그레이션·계정 권한·카테고리 충돌과 현재 DB 상태를 확인한 뒤 재실행하세요.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
