import { IsIn, IsOptional } from 'class-validator';

import { BOOK_JOURNAL_STATUSES, type BookJournalStatus } from '@bookorbit/types';

export class BookJournalQueryDto {
  @IsOptional()
  @IsIn(BOOK_JOURNAL_STATUSES)
  status?: BookJournalStatus;
}
