import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { ReadingAttemptOutcome, ReadingHistorySort } from '@bookorbit/types';
import { READING_ATTEMPT_OUTCOMES, READING_HISTORY_PAGE_SIZE_MAX, READING_HISTORY_SORTS } from '@bookorbit/types';

/** A period: a calendar year, optionally narrowed to one of its quarters. Neither means all time. */
export class ReadingHistoryPeriodQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(9999)
  year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  quarter?: number;
}

export class ReadingHistoryQueryDto extends ReadingHistoryPeriodQueryDto {
  /** Repeat the parameter or separate with commas. Defaults to completed reads only. */
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').filter(Boolean) : []))
  @IsArray()
  @IsIn(READING_ATTEMPT_OUTCOMES, { each: true })
  outcomes?: ReadingAttemptOutcome[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId?: number;

  @IsOptional()
  @IsIn(READING_HISTORY_SORTS)
  sort?: ReadingHistorySort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(READING_HISTORY_PAGE_SIZE_MAX)
  limit?: number;
}

export class UpdateReadRatingDto {
  /** 1-5 stars, or null to clear this read's rating. */
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number | null;
}
