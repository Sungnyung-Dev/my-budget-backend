import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { prisma } from './db/prisma.ts';

try {
  const app = createApp();
  await prisma.$connect();
  const server = app.listen(env.PORT, env.HOST, () => {
    console.info(`가계부 서버 실행: http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
  });

  server.on('error', async (error: NodeJS.ErrnoException) => {
    console.error(`HTTP 서버 시작 실패 (${error.code ?? 'UNKNOWN'})`);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    server.close(async () => {
      await prisma.$disconnect();
      clearTimeout(timer);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch {
  console.error('서버 시작 실패: 인증 설정, DATABASE_URL, MySQL 실행 상태와 계정 권한을 확인하세요.');
  await prisma.$disconnect();
  process.exitCode = 1;
}
