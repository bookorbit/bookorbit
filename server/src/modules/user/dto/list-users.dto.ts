import { USER_LIST_SORT_FIELDS, USER_LIST_STATES } from '@bookorbit/types';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListUsersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page = 0;

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
  @IsIn(USER_LIST_STATES)
  state?: (typeof USER_LIST_STATES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(20)
  provisioningMethod?: string;

  @IsOptional()
  @IsIn(USER_LIST_SORT_FIELDS)
  sortBy: (typeof USER_LIST_SORT_FIELDS)[number] = 'username';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir: 'asc' | 'desc' = 'asc';
}
