import express from 'express';
import { ApiError, createErrorHandler, requestId, type ErrorLogger } from './middleware/errorHandler.ts';
import { createCategoriesRouter } from './modules/categories/categories.routes.ts';
import { createCategoriesService, type CategoriesService } from './modules/categories/categories.service.ts';
import { createLedgerRouter } from './modules/ledger/ledger.routes.ts';
import { createLedgerService, type LedgerService } from './modules/ledger/ledger.service.ts';
import { createTransactionsRouter } from './modules/transactions/transactions.routes.ts';
import { createTransactionsService, type TransactionsService } from './modules/transactions/transactions.service.ts';

interface AppOptions {
  categoriesService?: CategoriesService;
  transactionsService?: TransactionsService;
  ledgerService?: LedgerService;
  logger?: ErrorLogger;
}

export function createApp({
  categoriesService = createCategoriesService(), transactionsService = createTransactionsService(),
  ledgerService = createLedgerService(), logger,
}: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(requestId);

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.use(express.json({ limit: '16kb', inflate: false }));
  app.use('/api/v1/categories', (request, response, next) => {
    response.locals.routeBase = request.baseUrl;
    next();
  }, createCategoriesRouter(categoriesService));
  app.use('/api/v1/transactions', (request, response, next) => {
    response.locals.routeBase = request.baseUrl;
    next();
  }, createTransactionsRouter(transactionsService));
  app.use('/api/v1/ledger', (request, response, next) => {
    response.locals.routeBase = request.baseUrl;
    next();
  }, createLedgerRouter(ledgerService));
  app.use((_request, _response, next) => {
    next(new ApiError(404, 'API_NOT_FOUND', 'API 경로를 찾을 수 없습니다.'));
  });
  app.use(createErrorHandler(logger));
  return app;
}

export const app = createApp();
