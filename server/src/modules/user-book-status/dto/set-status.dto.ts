import { IsIn } from 'class-validator';
import type { ReadStatus } from '@projectx/types';

export class SetStatusDto {
  @IsIn(['unread', 'reading', 'read', 'abandoned'])
  status!: ReadStatus;
}
