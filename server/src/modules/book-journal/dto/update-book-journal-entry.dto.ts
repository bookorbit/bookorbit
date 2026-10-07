import { Transform } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

import {
  BOOK_JOURNAL_BODY_MAX_LENGTH,
  BOOK_JOURNAL_CFI_MAX_LENGTH,
  BOOK_JOURNAL_CHAPTER_TITLE_MAX_LENGTH,
  BOOK_JOURNAL_QUOTE_MAX_LENGTH,
  type BookJournalEntryUpdate,
} from '@bookorbit/types';

import { trimJournalText } from './journal-text.transform';

export class UpdateBookJournalEntryDto implements BookJournalEntryUpdate {
  // Not nullable: an entry always has a body, so `null` is rejected rather than read as "clear".
  @ValidateIf((o: UpdateBookJournalEntryDto) => o.body !== undefined)
  @Transform(trimJournalText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BOOK_JOURNAL_BODY_MAX_LENGTH)
  body?: string;

  @IsOptional()
  @ValidateIf((o: UpdateBookJournalEntryDto) => o.quote !== null)
  @IsString()
  @MaxLength(BOOK_JOURNAL_QUOTE_MAX_LENGTH)
  quote?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateBookJournalEntryDto) => o.chapterTitle !== null)
  @IsString()
  @MaxLength(BOOK_JOURNAL_CHAPTER_TITLE_MAX_LENGTH)
  chapterTitle?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateBookJournalEntryDto) => o.positionPercent !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  positionPercent?: number | null;

  @IsOptional()
  @ValidateIf((o: UpdateBookJournalEntryDto) => o.cfi !== null)
  @IsString()
  @MaxLength(BOOK_JOURNAL_CFI_MAX_LENGTH)
  cfi?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateBookJournalEntryDto) => o.positionSeconds !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  positionSeconds?: number | null;
}
