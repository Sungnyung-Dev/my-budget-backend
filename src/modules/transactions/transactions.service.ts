import { setTimeout } from 'node:timers/promises';
import { prisma } from '../../db/prisma.ts';
import { assertLedgerTotal, toTransactionDto } from '../../domain/ledger.ts';
import { Prisma, type TransactionType } from '../../generated/prisma/client.ts';
import { ApiError } from '../../middleware/errorHandler.ts';
import type { CreateTransactionInput, TransactionsQuery, UpdateTransactionInput } from './transactions.validation.ts';

export interface TransactionsDatabase {
  transaction: Prisma.TransactionClient['transaction'];
  $transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options: {
    isolationLevel: Prisma.TransactionIsolationLevel;
    maxWait: number;
    timeout: number;
  }): Promise<T>;
}

function notFound(): ApiError {
  return new ApiError(404, 'TRANSACTION_NOT_FOUND', '거래를 찾을 수 없습니다.');
}

function transactionError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2025':
        throw notFound();
      case 'P2003':
        throw new ApiError(400, 'INVALID_CATEGORY', '카테고리가 존재하지 않거나 거래 유형과 일치하지 않습니다.');
      case 'P2000':
      case 'P2004':
        throw new ApiError(400, 'INVALID_REQUEST', '거래 데이터가 허용 범위를 벗어났습니다.');
      case 'P2002':
        throw new ApiError(409, 'TRANSACTION_CONFLICT', '거래 데이터가 충돌했습니다. 다시 시도해 주세요.');
      case 'P2034':
        throw new ApiError(409, 'TRANSACTION_WRITE_CONFLICT', '동시 변경이 충돌했습니다. 다시 시도해 주세요.');
    }
  }
  throw error;
}

async function checkCategory(tx: Prisma.TransactionClient, categoryId: string, type: TransactionType): Promise<void> {
  const category = await tx.category.findUnique({ where: { id: categoryId } });
  if (!category) throw new ApiError(400, 'INVALID_CATEGORY', '카테고리를 찾을 수 없습니다.');
  if (category.type !== type) {
    throw new ApiError(400, 'CATEGORY_TYPE_MISMATCH', '거래 유형과 카테고리 유형이 일치해야 합니다.');
  }
}

async function checkTotal(tx: Prisma.TransactionClient, difference: bigint): Promise<void> {
  const result = await tx.transaction.aggregate({ _sum: { amount: true } });
  try {
    assertLedgerTotal((result._sum.amount ?? 0n) + difference);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new ApiError(409, 'LEDGER_TOTAL_LIMIT_EXCEEDED', error.message);
  }
}

export function createTransactionsService(database: TransactionsDatabase = prisma) {
  async function write<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        // 합계 읽기와 쓰기를 직렬화하여 서로 다른 서버 프로세스의 요청도 보호합니다.
        return await database.$transaction(run, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) {
          await setTimeout(10 * (attempt + 1) + Math.floor(Math.random() * 10));
          continue;
        }
        return transactionError(error);
      }
    }
  }

  return {
    async list(query: TransactionsQuery = {}) {
      const transactions = await database.transaction.findMany({
        where: { date: { gte: query.from, lt: query.to } },
        orderBy: [{ date: 'desc' }, { id: 'asc' }],
      });
      return transactions.map(toTransactionDto);
    },

    async get(id: string) {
      const transaction = await database.transaction.findUnique({ where: { id } });
      if (!transaction) throw notFound();
      return toTransactionDto(transaction);
    },

    async create(input: CreateTransactionInput) {
      return write(async tx => {
        await checkCategory(tx, input.categoryId, input.type);
        await checkTotal(tx, input.amount);
        return toTransactionDto(await tx.transaction.create({ data: input }));
      });
    },

    async update(id: string, input: UpdateTransactionInput) {
      return write(async tx => {
        const current = await tx.transaction.findUnique({ where: { id } });
        if (!current) throw notFound();
        const categoryId = input.categoryId ?? current.categoryId;
        const type = input.type ?? current.type;
        await checkCategory(tx, categoryId, type);
        await checkTotal(tx, (input.amount ?? current.amount) - current.amount);
        // 이전 값을 펼쳐 쓰지 않고 제공된 필드만 변경합니다.
        return toTransactionDto(await tx.transaction.update({ where: { id }, data: input }));
      });
    },

    async remove(id: string) {
      return write(async tx => {
        const result = await tx.transaction.deleteMany({ where: { id } });
        if (result.count === 0) throw notFound();
      });
    },
  };
}

export type TransactionsService = ReturnType<typeof createTransactionsService>;
