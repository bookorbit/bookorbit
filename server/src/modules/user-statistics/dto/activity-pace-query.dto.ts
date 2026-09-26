import { ACTIVITY_MEDIA_BUCKETS, type ActivityMediaBucket } from '@bookorbit/types';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { UserStatisticsFilterQueryDto } from './user-statistics-filter-query.dto';

export class ActivityPaceQueryDto extends UserStatisticsFilterQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  format?: string;

  @IsOptional()
  @IsIn(ACTIVITY_MEDIA_BUCKETS)
  media?: ActivityMediaBucket;
}
