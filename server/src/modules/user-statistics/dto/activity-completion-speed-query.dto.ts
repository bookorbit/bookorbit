import { IsOptional, IsString, MaxLength } from 'class-validator';

import { UserStatisticsFilterQueryDto } from './user-statistics-filter-query.dto';

export class ActivityCompletionSpeedQueryDto extends UserStatisticsFilterQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  format?: string;
}
