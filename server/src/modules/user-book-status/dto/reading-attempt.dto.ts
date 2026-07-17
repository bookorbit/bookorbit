import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateIf } from 'class-validator';
import type { ReadingAttemptOutcome } from '@bookorbit/types';
import { READING_ATTEMPT_OUTCOMES } from '@bookorbit/types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ListReadingAttemptsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class CreateReadingAttemptDto {
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(DATE_PATTERN)
  startedOn?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(DATE_PATTERN)
  endedOn?: string | null;

  @IsIn(READING_ATTEMPT_OUTCOMES)
  outcome!: ReadingAttemptOutcome;
}

export class UpdateReadingAttemptDto {
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(DATE_PATTERN)
  startedOn?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(DATE_PATTERN)
  endedOn?: string | null;

  @IsOptional()
  @IsIn(READING_ATTEMPT_OUTCOMES)
  outcome?: ReadingAttemptOutcome | null;
}

export class StartRereadDto {
  @IsOptional()
  @IsBoolean()
  resetProgress?: boolean;
}
