import { ArrayNotEmpty, IsArray, IsIn, IsInt } from 'class-validator';
import type { ReadStatus } from '@bookorbit/types';
import { READ_STATUSES } from '../../user-book-status/user-book-status.constants';

export class BulkSetStatusDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  bookIds: number[];

  @IsIn(READ_STATUSES)
  status!: ReadStatus;
}
