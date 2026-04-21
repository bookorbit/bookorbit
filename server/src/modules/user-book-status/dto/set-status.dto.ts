import { IsIn } from 'class-validator';
import type { ReadStatus } from '@bookorbit/types';
import { READ_STATUSES } from '../user-book-status.constants';

export class SetStatusDto {
  @IsIn(READ_STATUSES)
  status!: ReadStatus;
}
