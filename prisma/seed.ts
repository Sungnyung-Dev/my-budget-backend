import { env } from '../src/config/env.ts';
import { prisma } from '../src/db/prisma.ts';
import { seedCategories } from './seed-categories.ts';

try {
  const url = new URL(env.DATABASE_URL);
  if (env.NODE_ENV !== 'development' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('이 Seed는 NODE_ENV=development인 로컬 개발 DB에서만 실행할 수 있습니다.');
  }
  await prisma.$transaction(tx => seedCategories(tx));
  console.info('기본 카테고리 Seed 완료 (거래 생성 없음).');
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith('이 Seed는')
    ? error.message : 'Seed 실패: DB 연결, 마이그레이션 및 카테고리 제약조건을 확인하세요.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
