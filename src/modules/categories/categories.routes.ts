import { Router, type Request } from 'express';
import { z } from 'zod';
import { ApiError } from '../../middleware/errorHandler.ts';
import type { CategoriesService } from './categories.service.ts';
import {
  categoriesQuery, categoryParams, createCategoryBody, emptyQuery, renameCategoryBody,
} from './categories.validation.ts';

function requireJson(request: Request): void {
  if (!request.is('application/json')) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Content-Type은 application/json이어야 합니다.');
  }
}

export function createCategoriesRouter(service: CategoriesService): Router {
  const router = Router();

  router.get('/', async (request, response) => {
    const { type } = categoriesQuery.parse(request.query);
    response.json(await service.list(type));
  });

  router.post('/', async (request, response) => {
    emptyQuery.parse(request.query);
    requireJson(request);
    const input = createCategoryBody.parse(request.body);
    response.status(201).json(await service.create(input));
  });

  router.patch('/:id', async (request, response) => {
    const { id } = categoryParams.parse(request.params);
    emptyQuery.parse(request.query);
    requireJson(request);
    const input = renameCategoryBody.parse(request.body);
    response.json(await service.rename(id, input));
  });

  router.delete('/:id', async (request, response) => {
    const { id } = categoryParams.parse(request.params);
    emptyQuery.parse(request.query);
    if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) > 0) {
      throw new ApiError(400, 'INVALID_REQUEST', '삭제 요청에는 본문을 포함할 수 없습니다.');
    }
    z.undefined({ error: '삭제 요청에는 본문을 포함할 수 없습니다.' }).parse(request.body);
    await service.remove(id);
    response.status(204).end();
  });

  return router;
}
