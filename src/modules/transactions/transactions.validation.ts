import { z } from 'zod';
import { amountToBigInt, dateToPrisma, normalizeMemo } from '../../domain/ledger.ts';
import { domainValue, resourceId, strictMessage, transactionType } from '../../validation/request.ts';

const date = domainValue(z.string({ error: '날짜는 YYYY-MM-DD 문자열이어야 합니다.' }), dateToPrisma);
const fields = {
  type: transactionType,
  amount: domainValue(z.number({ error: '금액은 숫자여야 합니다.' }), amountToBigInt),
  categoryId: resourceId,
  date,
  memo: domainValue(z.string({ error: '메모는 문자열이어야 합니다.' }), normalizeMemo),
};

export const createTransactionBody = z.strictObject(fields, strictMessage);
export const updateTransactionBody = z.strictObject(fields, strictMessage).partial()
  .refine(value => Object.keys(value).length > 0, { error: '수정할 필드를 하나 이상 지정해 주세요.' });
export const transactionsQuery = z.strictObject({ from: date.optional(), to: date.optional() }, strictMessage)
  .refine(value => !value.from || !value.to || value.from <= value.to, { error: 'from은 to보다 늦을 수 없습니다.' });

export type CreateTransactionInput = z.infer<typeof createTransactionBody>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionBody>;
export type TransactionsQuery = z.infer<typeof transactionsQuery>;
