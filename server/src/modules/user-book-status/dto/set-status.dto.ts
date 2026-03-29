import { IsIn } from 'class-validator';
import type { ReadStatus } from '@projectx/types';

export class SetStatusDto {
  @IsIn(['unread', 'want_to_read', 'reading', 'on_hold', 'rereading', 'read', 'skimmed', 'abandoned'])
  status!: ReadStatus;
}
