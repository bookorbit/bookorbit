import { ACCOUNT_ACTIVITY_SORT_FIELDS, ACCOUNT_ACTIVITY_STATES } from '@bookorbit/types';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListAccountActivityDto {
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
  pageSize = 50;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(ACCOUNT_ACTIVITY_STATES)
  state?: (typeof ACCOUNT_ACTIVITY_STATES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(20)
  provisioningMethod?: string;

  @IsOptional()
  @IsIn(ACCOUNT_ACTIVITY_SORT_FIELDS)
  sortBy: (typeof ACCOUNT_ACTIVITY_SORT_FIELDS)[number] = 'lastAuthenticatedAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir: 'asc' | 'desc' = 'desc';
}
