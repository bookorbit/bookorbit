import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';

import {
  NOTEBOOK_BOOKS_PAGE_SIZE_MAX,
  NOTEBOOK_ENTRY_KINDS,
  NOTEBOOK_PAGE_SIZE_MAX,
  NOTEBOOK_SEARCH_MAX_LENGTH,
  NOTEBOOK_SORTS,
  type NotebookEntryKind,
  type NotebookSort,
} from '@bookorbit/types';

import { isDateKey, isValidTimeZone } from '../../../common/utils/timezone.utils';
import { NOTEBOOK_ORIGINS, type NotebookOrigin } from '../notebook-filters';

const PG_INT_MAX = 2_147_483_647;
const CURSOR_MAX_LENGTH = 512;
const TIME_ZONE_MAX_LENGTH = 100;

/** Query strings only ever carry text, so only the two spellings of a boolean are converted. */
function toBoolean({ value }: TransformFnParams): unknown {
  return value === 'true' ? true : value === 'false' ? false : value;
}

/** `a,b` and a repeated `?x=a&x=b` both arrive as one de-duplicated list. */
function toList({ value }: TransformFnParams): unknown {
  const raw: unknown[] = Array.isArray(value) ? value : [value];
  if (!raw.every((part): part is string => typeof part === 'string')) return value;
  const parts = raw
    .flatMap((part) => part.split(','))
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

function trimmed({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function IsDateKey(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isDateKey',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isDateKey(value),
        defaultMessage: () => '$property must be a calendar date in YYYY-MM-DD form',
      },
    },
    validationOptions,
  );
}

function IsIanaTimeZone(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isIanaTimeZone',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && value.trim() !== '' && isValidTimeZone(value),
        defaultMessage: () => '$property must be an IANA time zone',
      },
    },
    validationOptions,
  );
}

/** The filters every entry route shares. `false` on a boolean means no filter, as in the annotation hub. */
export class NotebookFiltersQueryDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  starred?: boolean;

  /** Comma-separated stored colour strings. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  colors?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasNote?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  approximate?: boolean;

  /** Comma-separated origins (web, koreader, kobo). */
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(NOTEBOOK_ORIGINS.length)
  @IsIn(NOTEBOOK_ORIGINS, { each: true })
  origins?: NotebookOrigin[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PG_INT_MAX)
  bookId?: number;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(NOTEBOOK_SEARCH_MAX_LENGTH)
  q?: string;
}

export class NotebookEntriesQueryDto extends NotebookFiltersQueryDto {
  /** Comma-separated kinds; every kind when absent. */
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(NOTEBOOK_ENTRY_KINDS.length)
  @IsIn(NOTEBOOK_ENTRY_KINDS, { each: true })
  kinds?: NotebookEntryKind[];

  @IsOptional()
  @IsIn(NOTEBOOK_SORTS)
  sort?: NotebookSort;

  @IsOptional()
  @IsString()
  @MaxLength(CURSOR_MAX_LENGTH)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTEBOOK_PAGE_SIZE_MAX)
  limit?: number;
}

export class NotebookOverviewQueryDto extends NotebookFiltersQueryDto {}

export class NotebookBooksQueryDto {
  /** Matched against the book's title and its authors' names. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(NOTEBOOK_SEARCH_MAX_LENGTH)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CURSOR_MAX_LENGTH)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTEBOOK_BOOKS_PAGE_SIZE_MAX)
  limit?: number;
}

/** Exactly one of `date` (the day's deck) and `seed` (a shuffle of the filtered highlights). */
export class NotebookReviewQueryDto extends NotebookFiltersQueryDto {
  @IsOptional()
  @IsDateKey()
  date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(Number.MIN_SAFE_INTEGER)
  @Max(Number.MAX_SAFE_INTEGER)
  seed?: number;
}

export class NotebookOnThisDayQueryDto {
  @IsDateKey()
  date!: string;

  /** Defaults to the reader's timezone setting. */
  @IsOptional()
  @IsString()
  @MaxLength(TIME_ZONE_MAX_LENGTH)
  @IsIanaTimeZone()
  tz?: string;
}

export class NotebookTrashQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(CURSOR_MAX_LENGTH)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTEBOOK_PAGE_SIZE_MAX)
  limit?: number;
}
