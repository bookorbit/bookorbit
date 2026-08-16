import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

import { DASHBOARD_WIDGET_BATCH_MAX, WIDGET_TYPES } from '@bookorbit/types';
import { DashboardWidgetBatchDto } from './dashboard-widget-batch.dto';

function constraintNames(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [...Object.keys(error.constraints ?? {}), ...constraintNames(error.children ?? [])]);
}

describe('DashboardWidgetBatchDto', () => {
  it('accepts the widgets a dashboard can hold', async () => {
    const dto = plainToInstance(DashboardWidgetBatchDto, { widgets: [...WIDGET_TYPES] });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects an empty batch', async () => {
    const dto = plainToInstance(DashboardWidgetBatchDto, { widgets: [] });

    expect(constraintNames(await validate(dto))).toContain('arrayMinSize');
  });

  it('rejects batches above the widget-count limit', async () => {
    const dto = plainToInstance(DashboardWidgetBatchDto, {
      widgets: Array.from({ length: DASHBOARD_WIDGET_BATCH_MAX + 1 }, () => 'reading-goal'),
    });

    expect(constraintNames(await validate(dto))).toContain('arrayMaxSize');
  });

  it('rejects an unknown widget type', async () => {
    const dto = plainToInstance(DashboardWidgetBatchDto, { widgets: ['reading-goal', 'podcast-streak'] });

    expect(constraintNames(await validate(dto))).toContain('isIn');
  });
});
