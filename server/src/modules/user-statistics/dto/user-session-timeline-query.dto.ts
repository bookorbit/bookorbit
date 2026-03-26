import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { UserStatisticsFilterQueryDto } from './user-statistics-filter-query.dto';

export class UserSessionTimelineQueryDto extends UserStatisticsFilterQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1970)
  @Max(2100)
  year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(53)
  week?: number;
}
