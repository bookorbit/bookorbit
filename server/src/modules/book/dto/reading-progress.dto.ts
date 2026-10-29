import { READING_POSITION_KINDS, READING_PROGRESS_MAX_WRITES, type ReadingPositionKind } from '@bookorbit/types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ReadingProgressQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fileId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId?: number;
}

// Each string is held to its column, so an oversized one is a 400 rather than a database error.
export class ReadingTextWriteDto {
  @ValidateIf((o: ReadingTextWriteDto) => o.cfi != null)
  @IsString()
  @MaxLength(2000)
  cfi?: string | null;

  @ValidateIf((o: ReadingTextWriteDto) => o.page != null)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  page?: number | null;
}

export class ReadingNarrationWriteDto {
  @ValidateIf((o: ReadingNarrationWriteDto) => o.seconds != null)
  @IsNumber()
  @Min(0)
  seconds?: number | null;

  @ValidateIf((o: ReadingNarrationWriteDto) => o.fragment != null)
  @IsString()
  @MaxLength(4096)
  fragment?: string | null;

  @ValidateIf((o: ReadingNarrationWriteDto) => o.sectionIndex != null)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  sectionIndex?: number | null;
}

export class ReadingKoboWriteDto {
  @ValidateIf((o: ReadingKoboWriteDto) => o.source != null)
  @IsString()
  @MaxLength(4096)
  source?: string | null;

  @ValidateIf((o: ReadingKoboWriteDto) => o.type != null)
  @IsString()
  @MaxLength(64)
  type?: string | null;

  @ValidateIf((o: ReadingKoboWriteDto) => o.value != null)
  @IsString()
  @MaxLength(255)
  value?: string | null;

  @ValidateIf((o: ReadingKoboWriteDto) => o.contentPercent != null)
  @IsNumber()
  @Min(0)
  @Max(100)
  contentPercent?: number | null;
}

export class ReadingProgressWriteDto {
  @IsInt()
  @Min(1)
  fileId!: number;

  @IsOptional()
  @IsIn(READING_POSITION_KINDS)
  kind?: ReadingPositionKind;

  @IsNumber()
  @Min(0)
  @Max(100)
  percentage!: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  editedAt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReadingTextWriteDto)
  text?: ReadingTextWriteDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReadingNarrationWriteDto)
  narration?: ReadingNarrationWriteDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReadingKoboWriteDto)
  kobo?: ReadingKoboWriteDto;

  @ValidateIf((o: ReadingProgressWriteDto) => o.koreader != null)
  @IsString()
  koreader?: string | null;
}

export class ReadingProgressWritesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(READING_PROGRESS_MAX_WRITES)
  @ArrayUnique((write: ReadingProgressWriteDto) => write.fileId)
  @ValidateNested({ each: true })
  @Type(() => ReadingProgressWriteDto)
  writes!: ReadingProgressWriteDto[];
}
