import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIP,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  Max,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BOOK_REQUEST_MEDIA_KINDS, INDEXER_COLORS, MAX_INDEXER_SEED_TIME_MINUTES } from '@bookorbit/types';
import type { BookRequestMediaKind, IndexerAdapterTypeName, IndexerColor } from '@bookorbit/types';

/** The same slug shape the `adapter_type` CHECK enforces. */
const ADAPTER_TYPE_SLUG = /^[a-z0-9][a-z0-9-]{0,29}$/;

abstract class IndexerSeedPolicyDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  applyTrackerSeedGoals?: boolean;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  seedRatioGoal?: number | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_INDEXER_SEED_TIME_MINUTES)
  seedTimeMinutes?: number | null;
}

/** Category ids are the indexer's own numbering, so the only thing to validate is the shape. */
class IndexerCategoriesDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsInt({ each: true })
  @Min(0, { each: true })
  ebook?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsInt({ each: true })
  @Min(0, { each: true })
  audiobook?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsInt({ each: true })
  @Min(0, { each: true })
  comic?: number[];
}

/**
 * How the server should reach this source. Operator configuration rather than adapter choice, so
 * it is validated here in full: the proxy address is the one value that decides where a request
 * actually goes, and a bad one must be refused at the form.
 */
export class NetworkProfileDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIP(undefined, { each: true })
  resolvers?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^https?:\/\//, { message: 'proxyUrl must be an http or https address' })
  proxyUrl?: string;
}

export class CreateIndexerDto extends IndexerSeedPolicyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /**
   * Only shape here. Which adapter names exist is a runtime fact once adapters can be loaded from
   * disk, so `IndexerConfigService` rejects an unknown one against the registry instead.
   */
  @IsString()
  @Matches(ADAPTER_TYPE_SLUG)
  adapterType!: IndexerAdapterTypeName;

  @IsString()
  @MaxLength(2048)
  baseUrl!: string;

  /**
   * A slug from the closed palette, never a colour value: the client resolves it to a token tuned
   * per theme. `IsOptional` passes null through, which is how a colour is cleared.
   */
  @IsOptional()
  @IsIn(INDEXER_COLORS)
  color?: IndexerColor | null;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  credential?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPrivateAddress?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => IndexerCategoriesDto)
  categories?: IndexerCategoriesDto;

  /**
   * Narrowing only, and bounded by how many media exist rather than by a guess. Listing a medium
   * the adapter does not carry is allowed and does nothing: that source was already left out.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BOOK_REQUEST_MEDIA_KINDS.length)
  @IsIn(BOOK_REQUEST_MEDIA_KINDS, { each: true })
  disabledMediaKinds?: BookRequestMediaKind[];

  /** Accepted for any adapter, and simply unused by one that never searches an ISBN. */
  @IsOptional()
  @IsBoolean()
  isbnSearchDisabled?: boolean;

  /**
   * Deliberately opaque here. An adapter loaded at runtime declares its own fields, so no class
   * could enumerate them; `IndexerConfigService` validates the object against the adapter's own
   * `settingsFields` and drops anything it did not declare, which is the same protection
   * `forbidNonWhitelisted` gives the fields it does know about.
   */
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => NetworkProfileDto)
  networkProfile?: NetworkProfileDto | null;
}

/**
 * Spelled out rather than derived from the create DTO: `whitelist` plus `forbidNonWhitelisted`
 * means the accepted field list has to be exact, and an inherited-then-loosened field is easy to
 * get subtly wrong.
 */
export class UpdateIndexerDto extends IndexerSeedPolicyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(ADAPTER_TYPE_SLUG)
  adapterType?: IndexerAdapterTypeName;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  baseUrl?: string;

  /**
   * A slug from the closed palette, never a colour value: the client resolves it to a token tuned
   * per theme. `IsOptional` passes null through, which is how a colour is cleared.
   */
  @IsOptional()
  @IsIn(INDEXER_COLORS)
  color?: IndexerColor | null;

  /** An omitted credential keeps the stored one; an empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  credential?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPrivateAddress?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => IndexerCategoriesDto)
  categories?: IndexerCategoriesDto;

  /**
   * Narrowing only, and bounded by how many media exist rather than by a guess. Listing a medium
   * the adapter does not carry is allowed and does nothing: that source was already left out.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BOOK_REQUEST_MEDIA_KINDS.length)
  @IsIn(BOOK_REQUEST_MEDIA_KINDS, { each: true })
  disabledMediaKinds?: BookRequestMediaKind[];

  /** Accepted for any adapter, and simply unused by one that never searches an ISBN. */
  @IsOptional()
  @IsBoolean()
  isbnSearchDisabled?: boolean;

  /**
   * Deliberately opaque here. An adapter loaded at runtime declares its own fields, so no class
   * could enumerate them; `IndexerConfigService` validates the object against the adapter's own
   * `settingsFields` and drops anything it did not declare, which is the same protection
   * `forbidNonWhitelisted` gives the fields it does know about.
   */
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => NetworkProfileDto)
  networkProfile?: NetworkProfileDto | null;
}

export class InstallPluginUpdateDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  sha256!: string;
}

export class UpdatePluginAutomaticDto {
  @IsBoolean()
  enabled!: boolean;
}
