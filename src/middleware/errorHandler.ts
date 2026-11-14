import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.ts';

export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ErrorLog {
  requestId: string;
  method: string;
  route: string;
  errorType: string;
  prismaCode?: string;
  locations: string[];
}

export type ErrorLogger = (entry: ErrorLog) => void;

export const requestId: RequestHandler = (_request, response, next) => {
  response.locals.requestId = randomUUID();
  response.setHeader('X-Request-Id', response.locals.requestId);
  next();
};

const parserErrorTypes = new Set([
  'entity.parse.failed', 'entity.too.large', 'encoding.unsupported',
  'charset.unsupported', 'request.aborted', 'request.size.invalid',
]);

export function createErrorHandler(log: ErrorLogger = entry => console.error(entry)): ErrorRequestHandler {
  return (error: unknown, request, response, next) => {
    if (response.headersSent) {
      // 기본 Express 핸들러가 원본 오류를 출력하지 않도록 민감한 내용을 제거합니다.
      next(new Error('응답 전송 중 서버 오류가 발생했습니다.'));
      return;
    }

    let apiError: ApiError | undefined;
    if (error instanceof ApiError) {
      apiError = error;
    } else if (error instanceof ZodError) {
      apiError = new ApiError(400, 'INVALID_REQUEST', error.issues[0]?.message ?? '요청 형식이 올바르지 않습니다.');
    } else if (error && typeof error === 'object' &&
      (('type' in error && typeof error.type === 'string' && parserErrorTypes.has(error.type)) ||
       (error instanceof URIError && 'status' in error && error.status === 400))) {
      apiError = new ApiError(400, 'INVALID_REQUEST', '요청 형식이 올바르지 않습니다.');
    }

    if (apiError) {
      response.status(apiError.status).json({ error: { code: apiError.code, message: apiError.message } });
      return;
    }

    const knownPrismaError = error instanceof Prisma.PrismaClientKnownRequestError;
    // 원본 message, meta, SQL, URL, 본문, 헤더는 로그에 넣지 않습니다.
    // 스택에서는 프로젝트 코드의 상대 위치만 추출합니다.
    const locations = error instanceof Error
      ? (error.stack?.split('\n').slice(1).flatMap(line => {
        if (!line.trimStart().startsWith('at ')) return [];
        const location = line.match(/\/(?:src|dist)\/[\w./-]+:\d+:\d+(?=\)?$)/)?.[0];
        return location ? [location] : [];
      }) ?? [])
      : [];
    log({
      requestId: response.locals.requestId as string,
      method: request.method,
      route: typeof request.route?.path === 'string' ? `${response.locals.routeBase ?? ''}${request.route.path}` : 'unmatched',
      errorType: knownPrismaError ? 'PrismaClientKnownRequestError' : error instanceof Error ? 'Error' : 'Unknown',
      ...(knownPrismaError && /^P\d{4}$/.test(error.code) ? { prismaCode: error.code } : {}),
      locations,
    });
    response.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: '서버 오류가 발생했습니다.' } });
  };
}
