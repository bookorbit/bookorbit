import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import type { BulkRenameStatus } from '@bookorbit/types';

const VALID_STATUSES: BulkRenameStatus[] = ['will_rename', 'unchanged', 'collision', 'no_pattern', 'error'];

export class BulkRenamePreviewQueryDto {
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  page: number = 1;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  pageSize: number = 50;

  @IsOptional()
  @IsIn(VALID_STATUSES)
  status?: BulkRenameStatus;

  /**
   * Free-text filter over title and current path. Applied across the whole candidate set rather
   * than the current page, so a match on a later page is still reachable.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;
}
