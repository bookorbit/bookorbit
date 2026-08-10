import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

import { DASHBOARD_SCROLLER_BATCH_MAX } from '@bookorbit/types';
import { DASHBOARD_SCROLLER_MAX_LIMIT, DashboardScrollerBatchDto } from './dashboard-scroller-batch.dto';

function constraintNames(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [...Object.keys(error.constraints ?? {}), ...constraintNames(error.children ?? [])]);
}

describe('DashboardScrollerBatchDto', () => {
  it('accepts a bounded valid book shelf batch', async () => {
    const dto = plainToInstance(DashboardScrollerBatchDto, {
      items: [
        { id: 'recent', type: 'recently-added', limit: 20 },
        { id: 'scope', type: 'smart-scope', limit: 50, smartScopeId: 7 },
      ],
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects batches above the item-count limit', async () => {
    const dto = plainToInstance(DashboardScrollerBatchDto, {
      items: Array.from({ length: DASHBOARD_SCROLLER_BATCH_MAX + 1 }, (_, index) => ({
        id: String(index),
        type: 'recently-added',
        limit: 20,
      })),
    });

    const errors = await validate(dto);

    expect(constraintNames(errors)).toContain('arrayMaxSize');
  });

  it('rejects an invalid nested scroller type', async () => {
    const dto = plainToInstance(DashboardScrollerBatchDto, {
      items: [{ id: 'invalid-type', type: 'continue-podcasts', limit: 20 }],
    });

    expect(constraintNames(await validate(dto))).toContain('isIn');
  });

  it('rejects a nested limit above the shared maximum', async () => {
    const dto = plainToInstance(DashboardScrollerBatchDto, {
      items: [{ id: 'too-large', type: 'random', limit: DASHBOARD_SCROLLER_MAX_LIMIT + 1 }],
    });

    expect(constraintNames(await validate(dto))).toContain('max');
  });
});
