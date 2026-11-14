import { Router } from 'express';
import { emptyQuery, idParams, requireJson, requireNoBody } from '../../validation/request.ts';
import type { TransactionsService } from './transactions.service.ts';
import { createTransactionBody, transactionsQuery, updateTransactionBody } from './transactions.validation.ts';

export function createTransactionsRouter(service: TransactionsService): Router {
  const router = Router();

  router.get('/', async (request, response) => {
    response.json(await service.list(transactionsQuery.parse(request.query)));
  });

  router.get('/:id', async (request, response) => {
    const { id } = idParams.parse(request.params);
    emptyQuery.parse(request.query);
    response.json(await service.get(id));
  });

  router.post('/', async (request, response) => {
    emptyQuery.parse(request.query);
    requireJson(request);
    response.status(201).json(await service.create(createTransactionBody.parse(request.body)));
  });

  router.patch('/:id', async (request, response) => {
    const { id } = idParams.parse(request.params);
    emptyQuery.parse(request.query);
    requireJson(request);
    response.json(await service.update(id, updateTransactionBody.parse(request.body)));
  });

  router.delete('/:id', async (request, response) => {
    const { id } = idParams.parse(request.params);
    emptyQuery.parse(request.query);
    requireNoBody(request);
    await service.remove(id);
    response.status(204).end();
  });

  return router;
}
