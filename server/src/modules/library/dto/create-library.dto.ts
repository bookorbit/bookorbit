import { RegexMetadataConfigDto } from './regex-metadata.dto';
import { Type } from 'class-transformer';
import { IsObject, ValidateNested } from 'class-validator';
import {
  ArrayMinSize,
  IsDefined,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsOptionalNotNull } from './optional-not-null.decorator';
import { Transform } from 'class-transformer';
import { ICON_VALUE_MAX_LENGTH, type AddedAtSource, type CoverAspectRatio, type LibraryType, type OrganizationMode } from '@bookorbit/types';

import {
  LIBRARY_ADDED_AT_SOURCES,
  LIBRARY_COVER_ASPECT_RATIOS,
  LIBRARY_FILE_WRITE_MAX_SIZE_MB_MAX,
  LIBRARY_FILE_WRITE_MAX_SIZE_MB_MIN,
  LIBRARY_MARK_AS_FINISHED_MAX,
  LIBRARY_MARK_AS_FINISHED_MIN,
  LIBRARY_ORGANIZATION_MODES,
  LIBRARY_READING_THRESHOLD_MAX,
  LIBRARY_READING_THRESHOLD_MIN,
} from '../library.constants';
import { IsLibraryAutoScanCronExpression } from '../library-cron.validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateLibraryDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['books', 'podcasts'])
  type?: LibraryType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsDefined()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(ICON_VALUE_MAX_LENGTH)
  icon: string;

  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  folders: string[];

  /** Podcast-only: roots holding podcast folders the user already has. Never written to. */
  @IsOptionalNotNull()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  localFolders?: string[];

  /** Podcast-only: automatically discover changes beneath local podcast roots. */
  @IsOptionalNotNull()
  @IsBoolean()
  watchLocalFolders?: boolean;

  @IsOptionalNotNull()
  @IsIn(LIBRARY_COVER_ASPECT_RATIOS)
  coverAspectRatio?: CoverAspectRatio;

  @IsOptionalNotNull()
  @IsBoolean()
  watch?: boolean;

  @IsOptional()
  @IsString()
  @ValidateIf((o: { autoScanCronExpression?: unknown }) => o.autoScanCronExpression !== null)
  @IsLibraryAutoScanCronExpression()
  autoScanCronExpression?: string | null;

  @IsOptionalNotNull()
  @IsArray()
  @IsString({ each: true })
  metadataPrecedence?: string[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RegexMetadataConfigDto)
  regexMetadata?: RegexMetadataConfigDto | null;

  @IsOptionalNotNull()
  @IsArray()
  @IsString({ each: true })
  formatPriority?: string[];

  @IsOptionalNotNull()
  @IsArray()
  @IsString({ each: true })
  allowedFormats?: string[];

  @IsOptionalNotNull()
  @IsIn(LIBRARY_ORGANIZATION_MODES)
  organizationMode?: OrganizationMode;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(LIBRARY_ADDED_AT_SOURCES)
  addedAtSource?: AddedAtSource;

  @IsOptionalNotNull()
  @IsArray()
  @IsString({ each: true })
  excludePatterns?: string[];

  @IsOptionalNotNull()
  @IsNumber()
  @Min(LIBRARY_READING_THRESHOLD_MIN)
  @Max(LIBRARY_READING_THRESHOLD_MAX)
  readingThreshold?: number;

  @IsOptionalNotNull()
  @IsNumber()
  @Min(LIBRARY_MARK_AS_FINISHED_MIN)
  @Max(LIBRARY_MARK_AS_FINISHED_MAX)
  markAsFinishedPercentComplete?: number;

  @IsOptional()
  @ValidateIf((o: { fileNamingPattern?: unknown }) => o.fileNamingPattern !== null)
  @IsString()
  @MaxLength(500)
  fileNamingPattern?: string | null;

  @IsOptionalNotNull()
  @IsBoolean()
  fileWriteEnabled?: boolean;

  @IsOptionalNotNull()
  @IsBoolean()
  fileWriteWriteCover?: boolean;

  @IsOptionalNotNull()
  @IsBoolean()
  fileWriteEpubEnabled?: boolean;

  @IsOptionalNotNull()
  @IsInt()
  @Min(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MIN)
  @Max(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MAX)
  fileWriteEpubMaxFileSizeMb?: number;

  @IsOptionalNotNull()
  @IsBoolean()
  fileWriteFb2Enabled?: boolean;

  @IsOptionalNotNull()
  @IsInt()
  @Min(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MIN)
  @Max(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MAX)
  fileWriteFb2MaxFileSizeMb?: number;

  @IsOptionalNotNull()
  @IsBoolean()
  fileWritePdfEnabled?: boolean;

  @IsOptionalNotNull()
  @IsInt()
  @Min(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MIN)
  @Max(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MAX)
  fileWritePdfMaxFileSizeMb?: number;

  @IsOptionalNotNull()
  @IsBoolean()
  fileWriteCbxEnabled?: boolean;

  @IsOptionalNotNull()
  @IsInt()
  @Min(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MIN)
  @Max(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MAX)
  fileWriteCbxMaxFileSizeMb?: number;

  @IsOptionalNotNull()
  @IsBoolean()
  fileWriteKindleEnabled?: boolean;

  @IsOptionalNotNull()
  @IsInt()
  @Min(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MIN)
  @Max(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MAX)
  fileWriteKindleMaxFileSizeMb?: number;

  @IsOptionalNotNull()
  @IsBoolean()
  fileWriteAudioEnabled?: boolean;

  @IsOptionalNotNull()
  @IsInt()
  @Min(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MIN)
  @Max(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MAX)
  fileWriteAudioMaxFileSizeMb?: number;

  @IsOptionalNotNull()
  @IsBoolean()
  fileWriteAllFiles?: boolean;

  @IsOptionalNotNull()
  @IsBoolean()
  fileWriteReadAlongEnabled?: boolean;

  @IsOptionalNotNull()
  @IsInt()
  @Min(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MIN)
  @Max(LIBRARY_FILE_WRITE_MAX_SIZE_MB_MAX)
  fileWriteReadAlongMaxFileSizeMb?: number;

  @IsOptionalNotNull()
  @IsBoolean()
  fileRenameEnabled?: boolean;
}
