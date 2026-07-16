import { READING_INSIGHTS_SHARING_LEVELS } from '@bookorbit/types';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateReadingInsightsSharingDto {
  @IsIn(READING_INSIGHTS_SHARING_LEVELS)
  sharingLevel!: (typeof READING_INSIGHTS_SHARING_LEVELS)[number];
}

export class SharedReadingInsightsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(3650)
  days = 90;
}

export class ReadingInsightsAccessHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
