import { IsEnum, IsOptional } from 'class-validator';

import type { StatisticsDateRange, StatisticsGranularity } from '@bookorbit/types';

import { StatisticsFilterQueryDto } from './statistics-filter-query.dto';

export class BooksOverTimeQueryDto extends StatisticsFilterQueryDto {
  @IsOptional()
  @IsEnum(['monthly', 'yearly'])
  granularity?: StatisticsGranularity;

  @IsOptional()
  @IsEnum(['last-year', 'last-5-years', 'all-time'])
  range?: StatisticsDateRange;
}
