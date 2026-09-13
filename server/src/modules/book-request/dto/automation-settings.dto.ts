import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BOOK_REQUEST_IMPORT_FORMATS,
  MAX_AUTO_GRAB_ATTEMPTS_LIMIT,
  MAX_AUTO_SEARCH_INTERVAL_HOURS,
  MAX_AUTO_SEARCH_MAX_AGE_DAYS,
  MAX_RELEASE_TIER_NAME_LENGTH,
  MAX_RELEASE_TIERS,
  MIN_AUTO_GRAB_SCORE_FLOOR,
  MIN_AUTO_SEARCH_INTERVAL_HOURS,
  MIN_AUTO_SEARCH_MAX_AGE_DAYS,
} from '@bookorbit/types';
import type { BookRequestImportFormats, ReleaseFileLayout } from '@bookorbit/types';

/**
 * Null clears the default for that medium, which is not the same as omitting it: an omitted
 * medium keeps whatever is stored, so one row can be changed without resending the other two.
 */
class RequestDestinationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  libraryId!: number | null;

  /** Left null to mean "the library's first folder", which the service resolves and stores. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  folderId!: number | null;
}

/**
 * Spelled out per medium rather than typed as a record: `whitelist` with `forbidNonWhitelisted`
 * needs an exact field list, and a record would take any key at all.
 */
class RequestDestinationDefaultsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => RequestDestinationDto)
  ebook?: RequestDestinationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RequestDestinationDto)
  audiobook?: RequestDestinationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RequestDestinationDto)
  comic?: RequestDestinationDto;
}

/**
 * One tier's conditions. Every field is optional, and an omitted one constrains nothing, so an
 * empty object is a tier that matches everything - which is exactly what a catch-all bottom tier
 * is for.
 */
class ReleaseTierConditionsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  formats?: string[];

  @IsOptional()
  @IsIn(['single', 'multi'])
  fileLayout?: ReleaseFileLayout;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minBitrateKbps?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  channels?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  indexerIds?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSeeders?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxSizeBytes?: number;

  @IsOptional()
  @IsBoolean()
  freeleechOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  excludeVipOnly?: boolean;
}

class ReleaseTierDto {
  /** Stable across reorders. The service refuses a duplicate, which a reorder cannot answer for. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_RELEASE_TIER_NAME_LENGTH)
  name!: string;

  /**
   * Defaulted rather than optional: a tier that states no conditions matches everything, which is
   * a legitimate catch-all bottom tier, and the initializer lets a caller omit the key entirely
   * without the field becoming undefined downstream.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ReleaseTierConditionsDto)
  conditions: ReleaseTierConditionsDto = {};
}

/** Spelled out per medium for the same reason the destinations are: a record would take any key. */
class ReleaseProfilesDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RELEASE_TIERS)
  @ValidateNested({ each: true })
  @Type(() => ReleaseTierDto)
  ebook?: ReleaseTierDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RELEASE_TIERS)
  @ValidateNested({ each: true })
  @Type(() => ReleaseTierDto)
  audiobook?: ReleaseTierDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RELEASE_TIERS)
  @ValidateNested({ each: true })
  @Type(() => ReleaseTierDto)
  comic?: ReleaseTierDto[];
}

/**
 * Every field is optional so one knob can be moved without resending the rest. The service
 * validates the same bounds again, because a value can also arrive from a hand-edited settings
 * row that never passed through this pipe.
 */
export class UpdateAutomationSettingsDto {
  @IsOptional()
  @IsBoolean()
  autoGrabEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_AUTO_GRAB_SCORE_FLOOR)
  @Max(100)
  autoGrabMinScore?: number;

  @IsOptional()
  @IsBoolean()
  autoRetryEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AUTO_GRAB_ATTEMPTS_LIMIT)
  maxAutoGrabAttempts?: number;

  @IsOptional()
  @IsBoolean()
  autoSearchEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_AUTO_SEARCH_INTERVAL_HOURS)
  @Max(MAX_AUTO_SEARCH_INTERVAL_HOURS)
  autoSearchIntervalHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_AUTO_SEARCH_MAX_AGE_DAYS)
  @Max(MAX_AUTO_SEARCH_MAX_AGE_DAYS)
  autoSearchMaxAgeDays?: number;

  @IsOptional()
  @IsBoolean()
  verificationEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  verificationThreshold?: number;

  @IsOptional()
  @IsIn(BOOK_REQUEST_IMPORT_FORMATS)
  importFormats?: BookRequestImportFormats;

  @IsOptional()
  @ValidateNested()
  @Type(() => RequestDestinationDefaultsDto)
  destinations?: RequestDestinationDefaultsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReleaseProfilesDto)
  profiles?: ReleaseProfilesDto;
}
