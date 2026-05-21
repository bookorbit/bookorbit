import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import type { CoverAspectRatio, OrganizationMode } from '@bookorbit/types';

import {
  LIBRARY_AUTO_SCAN_CRON_EXPRESSION_ERROR,
  LIBRARY_AUTO_SCAN_CRON_EXPRESSION_REGEX,
  LIBRARY_COVER_ASPECT_RATIOS,
  LIBRARY_FILE_WRITE_MAX_SIZE_MB_MAX,
  LIBRARY_FILE_WRITE_MAX_SIZE_MB_MIN,
  LIBRARY_MARK_AS_FINISHED_MAX,
  LIBRARY_MARK_AS_FINISHED_MIN,
  LIBRARY_ORGANIZATION_MODES,
  LIBRARY_READING_THRESHOLD_MAX,
  LIBRARY_READING_THRESHOLD_MIN,
} from '../library.constants';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateLibraryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  folders?: string[];

  @IsOptional()
  @IsIn(LIBRARY_COVER_ASPECT_RATIOS)
  coverAspectRatio?: CoverAspectRatio;

  @IsOptional()
  @IsBoolean()
  watch?: boolean;

  @IsOptional()
  @IsString()
  @ValidateIf((o: { autoScanCronExpression?: unknown }) => o.autoScanCronExpression !== null)
  @Matches(LIBRARY_AUTO_SCAN_CRON_EXPRESSION_REGEX, {
    message: LIBRARY_AUTO_SCAN_CRON_EXPRESSION_ERROR,
  })
  autoScanCronExpression?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  metadataPrecedence?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  formatPriority?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedFormats?: string[];

  @IsOptional()
  @IsIn(LIBRARY_ORGANIZATION_MODES)
  organizationMode?: OrganizationMode;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludePatterns?: string[];

  @IsOptional()
  @IsNumber()
  @Min(LIBRARY_READING_THRESHOLD_MIN)
  @Max(LIBRARY_READING_THRESHOLD_MAX)
  readingThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(LIBRARY_MARK_AS_FINISHED_MIN)
  @Max(LIBRARY_MARK_AS_FINISHED_MAX)
  markAsFinishedPercentComplete?: number;

  @IsOptional()
  @ValidateIf((o: { fileNamingPattern?: unknown }) => o.fileNamingPattern !== null)
  @IsString()
  @MaxLength(500)
  fileNamingPattern?: string | null;

  @IsOptional()
  @IsBoolean()
  fileWriteEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  fileWriteWriteCover?: boolean;

  @IsOptional()
  @IsBoolean()
  fileWriteEpubEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MIN)
  @Max(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MAX)
  fileWriteEpubMaxFileSizeMb?: number;

  @IsOptional()
  @IsBoolean()
  fileWritePdfEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MIN)
  @Max(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MAX)
  fileWritePdfMaxFileSizeMb?: number;

  @IsOptional()
  @IsBoolean()
  fileWriteCbxEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MIN)
  @Max(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MAX)
  fileWriteCbxMaxFileSizeMb?: number;

  @IsOptional()
  @IsBoolean()
  fileRenameEnabled?: boolean;
}
