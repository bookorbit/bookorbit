import { IsIn } from 'class-validator';
import type { ReadStatus } from '@bookorbit/types';
import { READ_STATUSES } from '../../user-book-status/user-book-status.constants';
import { BulkSelectionDto } from './bulk-selection.dto';

export class BulkSetStatusDto extends BulkSelectionDto {
  @IsIn(READ_STATUSES)
  status!: ReadStatus;
}
