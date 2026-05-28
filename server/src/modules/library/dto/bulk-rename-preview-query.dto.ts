import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
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
}
