import { Router } from 'express';
import { requireJson, requireNoBody } from '../../validation/request.ts';
import type { CategoriesService } from './categories.service.ts';
import {
  categoriesQuery, categoryParams, createCategoryBody, emptyQuery, renameCategoryBody,
} from './categories.validation.ts';

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
    requireNoBody(request);
    await service.remove(id);
    response.status(204).end();
  });

  return router;
}
