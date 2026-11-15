import { env } from '../src/config/env.ts';
import { prisma } from '../src/db/prisma.ts';
import { inspectDatabase } from './database-target.ts';

try {
  console.info(JSON.stringify(await inspectDatabase(prisma, env), null, 2));
  console.info('DB 연결 확인 완료 (읽기 전용, 데이터 변경 없음).');
} catch {
  console.error('DB 확인 실패: 환경변수, 실제 접속 대상 및 계정 권한을 확인하세요.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
