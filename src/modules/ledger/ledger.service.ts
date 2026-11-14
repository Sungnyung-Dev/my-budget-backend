import { prisma } from '../../db/prisma.ts';
import { toLedgerDto } from '../../domain/ledger.ts';
import { Prisma } from '../../generated/prisma/client.ts';

export interface LedgerDatabase {
  $transaction<T>(read: (tx: Prisma.TransactionClient) => Promise<T>, options: {
    isolationLevel: Prisma.TransactionIsolationLevel;
  }): Promise<T>;
}

export function createLedgerService(database: LedgerDatabase = prisma) {
  return {
    async get() {
      return database.$transaction(async tx => {
        // 두 일반 SELECT가 첫 조회 시점의 동일한 스냅샷을 읽습니다.
        const categories = await tx.category.findMany({
          orderBy: [{ type: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        });
        const transactions = await tx.transaction.findMany({
          orderBy: [{ date: 'desc' }, { id: 'asc' }],
        });
        return toLedgerDto(categories, transactions);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    },
  };
}

export type LedgerService = ReturnType<typeof createLedgerService>;
