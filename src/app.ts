import express from 'express';
import { ApiError, createErrorHandler, requestId, type ErrorLogger } from './middleware/errorHandler.ts';
import { createCategoriesRouter } from './modules/categories/categories.routes.ts';
import { createCategoriesService, type CategoriesService } from './modules/categories/categories.service.ts';

interface AppOptions {
  categoriesService?: CategoriesService;
  logger?: ErrorLogger;
}

export function createApp({ categoriesService = createCategoriesService(), logger }: AppOptions = {}) {
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
  app.use((_request, _response, next) => {
    next(new ApiError(404, 'API_NOT_FOUND', 'API 경로를 찾을 수 없습니다.'));
  });
  app.use(createErrorHandler(logger));
  return app;
}

export const app = createApp();
