import { Router } from 'express';
import { emptyQuery, requireNoBody } from '../../validation/request.ts';
import type { LedgerService } from './ledger.service.ts';

export function createLedgerRouter(service: LedgerService): Router {
  const router = Router();

  router.get('/', async (request, response) => {
    emptyQuery.parse(request.query);
    requireNoBody(request, 'Ledger 조회 요청에는 본문을 포함할 수 없습니다.');
    response.json(await service.get());
  });

  return router;
}
