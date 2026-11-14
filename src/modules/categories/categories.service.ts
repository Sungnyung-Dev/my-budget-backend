import { prisma } from '../../db/prisma.ts';
import { toCategoryDto } from '../../domain/ledger.ts';
import { Prisma, type TransactionType } from '../../generated/prisma/client.ts';
import { ApiError } from '../../middleware/errorHandler.ts';
import type { CreateCategoryInput, RenameCategoryInput } from './categories.validation.ts';

export type CategoriesDatabase = Pick<Prisma.TransactionClient, 'category'>;

function categoryError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        throw new ApiError(409, 'CATEGORY_NAME_CONFLICT', '이미 존재하는 카테고리 이름입니다.');
      case 'P2003':
        throw new ApiError(409, 'CATEGORY_IN_USE', '거래에서 사용 중인 카테고리는 삭제할 수 없습니다.');
      case 'P2025':
        throw new ApiError(404, 'CATEGORY_NOT_FOUND', '카테고리를 찾을 수 없습니다.');
    }
  }
  throw error;
}

export function createCategoriesService(database: CategoriesDatabase = prisma) {
  return {
    async list(type?: TransactionType) {
      const categories = await database.category.findMany({
        where: type ? { type } : {},
        orderBy: [{ type: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      });
      return categories.map(toCategoryDto);
    },

    async create(input: CreateCategoryInput) {
      try {
        const category = await database.category.create({ data: {
          name: input.name, type: input.type, symbol: input.symbol,
        } });
        return toCategoryDto(category);
      } catch (error) {
        return categoryError(error);
      }
    },

    async rename(id: string, input: RenameCategoryInput) {
      try {
        const category = await database.category.update({ where: { id }, data: { name: input.name } });
        return toCategoryDto(category);
      } catch (error) {
        return categoryError(error);
      }
    },

    async remove(id: string) {
      try {
        // 삭제 건수를 확인해야 동시 삭제에서도 한 요청만 성공합니다.
        // 외래키 RESTRICT는 동시 요청으로 추가되는 거래까지 보호합니다.
        const result = await database.category.deleteMany({ where: { id } });
        if (result.count === 0) {
          throw new ApiError(404, 'CATEGORY_NOT_FOUND', '카테고리를 찾을 수 없습니다.');
        }
      } catch (error) {
        categoryError(error);
      }
    },
  };
}

export type CategoriesService = ReturnType<typeof createCategoriesService>;
