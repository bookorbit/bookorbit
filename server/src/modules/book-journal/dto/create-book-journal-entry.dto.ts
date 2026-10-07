import { Transform } from 'class-transformer';
import { IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';

import {
  BOOK_JOURNAL_BODY_MAX_LENGTH,
  BOOK_JOURNAL_CFI_MAX_LENGTH,
  BOOK_JOURNAL_CHAPTER_TITLE_MAX_LENGTH,
  BOOK_JOURNAL_QUOTE_MAX_LENGTH,
  type BookJournalEntryCreate,
} from '@bookorbit/types';

import { trimJournalText } from './journal-text.transform';

export class CreateBookJournalEntryDto implements BookJournalEntryCreate {
  @IsUUID()
  clientId!: string;

  @Transform(trimJournalText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BOOK_JOURNAL_BODY_MAX_LENGTH)
  body!: string;

  @IsOptional()
  @ValidateIf((o: CreateBookJournalEntryDto) => o.quote !== null)
  @IsString()
  @MaxLength(BOOK_JOURNAL_QUOTE_MAX_LENGTH)
  quote?: string | null;

  @IsOptional()
  @ValidateIf((o: CreateBookJournalEntryDto) => o.chapterTitle !== null)
  @IsString()
  @MaxLength(BOOK_JOURNAL_CHAPTER_TITLE_MAX_LENGTH)
  chapterTitle?: string | null;

  @IsOptional()
  @ValidateIf((o: CreateBookJournalEntryDto) => o.positionPercent !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  positionPercent?: number | null;

  @IsOptional()
  @ValidateIf((o: CreateBookJournalEntryDto) => o.cfi !== null)
  @IsString()
  @MaxLength(BOOK_JOURNAL_CFI_MAX_LENGTH)
  cfi?: string | null;

  @IsOptional()
  @ValidateIf((o: CreateBookJournalEntryDto) => o.positionSeconds !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  positionSeconds?: number | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  createdAt?: string;
}
