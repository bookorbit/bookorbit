import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { DASHBOARD_SCROLLER_BATCH_MAX, DASHBOARD_SCROLLER_MAX_LIMIT, SCROLLER_TYPES, type ScrollerType } from '@bookorbit/types';

export { DASHBOARD_SCROLLER_MAX_LIMIT };

export class DashboardScrollerBatchItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  id!: string;

  @IsIn(SCROLLER_TYPES)
  type!: ScrollerType;

  @IsInt()
  @Min(1)
  @Max(DASHBOARD_SCROLLER_MAX_LIMIT)
  limit!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  smartScopeId?: number;
}

export class DashboardScrollerBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DASHBOARD_SCROLLER_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => DashboardScrollerBatchItemDto)
  items!: DashboardScrollerBatchItemDto[];
}
