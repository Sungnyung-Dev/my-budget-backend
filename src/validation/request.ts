import type { Request } from 'express';
import { z } from 'zod';
import { TransactionType } from '../generated/prisma/enums.ts';
import { ApiError } from '../middleware/errorHandler.ts';

export const strictMessage = { error: '요청 형식 또는 허용되지 않은 필드를 확인해 주세요.' };
export const resourceId = z.string({ error: 'ID는 문자열이어야 합니다.' })
  .min(1, 'ID가 필요합니다.').max(191, 'ID는 191자 이하여야 합니다.');
export const idParams = z.strictObject({ id: resourceId }, strictMessage);
export const emptyQuery = z.strictObject({}, strictMessage);
export const transactionType = z.enum(TransactionType, { error: 'type은 expense 또는 income이어야 합니다.' });

export function domainValue<Input, Output>(schema: z.ZodType<Input>, validate: (value: Input) => Output) {
  return schema.transform((value, context) => {
    try {
      return validate(value);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      context.addIssue({ code: 'custom', message: error.message });
      return z.NEVER;
    }
  });
}

export function requireJson(request: Request): void {
  if (!request.is('application/json')) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Content-Type은 application/json이어야 합니다.');
  }
}

export function requireNoBody(request: Request, message = '삭제 요청에는 본문을 포함할 수 없습니다.'): void {
  if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) > 0) {
    throw new ApiError(400, 'INVALID_REQUEST', message);
  }
  z.undefined({ error: message }).parse(request.body);
}
