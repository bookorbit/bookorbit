import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn } from 'class-validator';

import { DASHBOARD_WIDGET_BATCH_MAX, WIDGET_TYPES, type WidgetType } from '@bookorbit/types';

export class DashboardWidgetBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DASHBOARD_WIDGET_BATCH_MAX)
  @IsIn(WIDGET_TYPES, { each: true })
  widgets!: WidgetType[];
}
