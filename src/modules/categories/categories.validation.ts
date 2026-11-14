import { z } from 'zod';
import { normalizeCategoryName } from '../../domain/ledger.ts';
import { CategorySymbol } from '../../generated/prisma/enums.ts';
import { domainValue, strictMessage, transactionType } from '../../validation/request.ts';

const categoryName = domainValue(z.string({ error: 'name은 문자열이어야 합니다.' }), normalizeCategoryName);

export { idParams as categoryParams, emptyQuery } from '../../validation/request.ts';
export const categoriesQuery = z.strictObject({ type: transactionType.optional() }, strictMessage);
export const createCategoryBody = z.strictObject({
  name: categoryName,
  type: transactionType,
  symbol: z.enum(CategorySymbol, { error: '허용되지 않는 symbol입니다.' }),
}, strictMessage);
export const renameCategoryBody = z.strictObject({ name: categoryName }, strictMessage);

export type CreateCategoryInput = z.infer<typeof createCategoryBody>;
export type RenameCategoryInput = z.infer<typeof renameCategoryBody>;
