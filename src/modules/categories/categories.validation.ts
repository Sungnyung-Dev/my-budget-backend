import { z } from 'zod';
import { normalizeCategoryName } from '../../domain/ledger.ts';
import { CategorySymbol, TransactionType } from '../../generated/prisma/enums.ts';

const categoryName = z.string({ error: 'name은 문자열이어야 합니다.' }).transform((value, context) => {
  try {
    return normalizeCategoryName(value);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    context.addIssue({ code: 'custom', message: error.message });
    return z.NEVER;
  }
});

const transactionType = z.enum(TransactionType, { error: 'type은 expense 또는 income이어야 합니다.' });
const strictMessage = { error: '요청 형식 또는 허용되지 않은 필드를 확인해 주세요.' };

export const categoryParams = z.strictObject({
  id: z.string({ error: '카테고리 ID는 문자열이어야 합니다.' })
    .min(1, '카테고리 ID가 필요합니다.').max(191, '카테고리 ID는 191자 이하여야 합니다.'),
}, strictMessage);

export const categoriesQuery = z.strictObject({ type: transactionType.optional() }, strictMessage);
export const emptyQuery = z.strictObject({}, strictMessage);
export const createCategoryBody = z.strictObject({
  name: categoryName,
  type: transactionType,
  symbol: z.enum(CategorySymbol, { error: '허용되지 않는 symbol입니다.' }),
}, strictMessage);
export const renameCategoryBody = z.strictObject({ name: categoryName }, strictMessage);

export type CreateCategoryInput = z.infer<typeof createCategoryBody>;
export type RenameCategoryInput = z.infer<typeof renameCategoryBody>;
