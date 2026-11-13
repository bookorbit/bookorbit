import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AI_API_TYPES,
  AI_CONNECTION_LIMITS,
  AI_HEADER_MAX_COUNT,
  AI_HEADER_NAME_MAX_LENGTH,
  AI_HEADER_VALUE_MAX_LENGTH,
  AI_JSON_MODES,
  AI_KEY_MAX_LENGTH,
  AI_MODEL_MAX_LENGTH,
  AI_NAME_MAX_LENGTH,
  AI_SLOT_EFFORTS,
  AI_SLOTS,
  AI_URL_MAX_LENGTH,
  type AiApiType,
  type AiJsonMode,
  type AiSlot,
  type AiSlotEffort,
} from '@bookorbit/types';

import { NetworkProfileDto } from '../../book-request/indexers/dto/indexer.dto';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Dollars, for budgets and prices: generous, but finite. */
const MAX_DOLLARS = 1_000_000;
const MAX_BUILDS_PER_MONTH = 100_000;
const MAX_OUTPUT_TOKENS = 10_000_000;

export class AiConnectionHeaderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(AI_HEADER_NAME_MAX_LENGTH)
  name!: string;

  /** Absent on an edit keeps the stored value for this name. */
  @IsOptional()
  @IsString()
  @MaxLength(AI_HEADER_VALUE_MAX_LENGTH)
  value?: string;
}

export class CreateAiConnectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(AI_NAME_MAX_LENGTH)
  name!: string;

  @IsIn(AI_API_TYPES)
  apiType!: AiApiType;

  @IsString()
  @MinLength(1)
  @MaxLength(AI_URL_MAX_LENGTH)
  baseUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_KEY_MAX_LENGTH)
  key?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_HEADER_MAX_COUNT)
  @ValidateNested({ each: true })
  @Type(() => AiConnectionHeaderDto)
  headers?: AiConnectionHeaderDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => NetworkProfileDto)
  networkProfile?: NetworkProfileDto | null;

  @IsOptional()
  @IsInt()
  @Min(AI_CONNECTION_LIMITS.timeoutMs.min)
  @Max(AI_CONNECTION_LIMITS.timeoutMs.max)
  timeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(AI_CONNECTION_LIMITS.maxParallel.min)
  @Max(AI_CONNECTION_LIMITS.maxParallel.max)
  maxParallel?: number;

  @IsOptional()
  @IsInt()
  @Min(AI_CONNECTION_LIMITS.requestsPerMinute.min)
  @Max(AI_CONNECTION_LIMITS.requestsPerMinute.max)
  requestsPerMinute?: number | null;
}

/**
 * Spelled out rather than derived from the create DTO, so the accepted fields are exact. Absent
 * fields stay as they are; `key: null` removes the key; `headers` replaces the list.
 */
export class UpdateAiConnectionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(AI_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsIn(AI_API_TYPES)
  apiType?: AiApiType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(AI_URL_MAX_LENGTH)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_KEY_MAX_LENGTH)
  key?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_HEADER_MAX_COUNT)
  @ValidateNested({ each: true })
  @Type(() => AiConnectionHeaderDto)
  headers?: AiConnectionHeaderDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => NetworkProfileDto)
  networkProfile?: NetworkProfileDto | null;

  @IsOptional()
  @IsInt()
  @Min(AI_CONNECTION_LIMITS.timeoutMs.min)
  @Max(AI_CONNECTION_LIMITS.timeoutMs.max)
  timeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(AI_CONNECTION_LIMITS.maxParallel.min)
  @Max(AI_CONNECTION_LIMITS.maxParallel.max)
  maxParallel?: number;

  @IsOptional()
  @IsInt()
  @Min(AI_CONNECTION_LIMITS.requestsPerMinute.min)
  @Max(AI_CONNECTION_LIMITS.requestsPerMinute.max)
  requestsPerMinute?: number | null;
}

/** An unsaved connection to test. With `connectionId`, a missing key or header value comes from that saved one. */
export class TestAiConnectionDto extends CreateAiConnectionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  connectionId?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(AI_MODEL_MAX_LENGTH)
  model?: string;
}

export class TestSavedAiConnectionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(AI_MODEL_MAX_LENGTH)
  model?: string;
}

export class AiModelPricesDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_DOLLARS)
  input!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_DOLLARS)
  output!: number;
}

export class UpdateAiSlotDto {
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(1)
  connectionId!: number | null;

  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(AI_MODEL_MAX_LENGTH)
  model!: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => AiModelPricesDto)
  prices?: AiModelPricesDto | null;

  @IsOptional()
  @IsIn(AI_JSON_MODES)
  jsonMode?: AiJsonMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_OUTPUT_TOKENS)
  maxOutputTokens?: number | null;

  @IsOptional()
  @IsIn(AI_SLOT_EFFORTS)
  effort?: AiSlotEffort;
}

/** Slots left out stay as they are. */
export class UpdateAiSlotsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAiSlotDto)
  fast?: UpdateAiSlotDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAiSlotDto)
  careful?: UpdateAiSlotDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAiSlotDto)
  vision?: UpdateAiSlotDto;
}

/** Ranges are the feature's own and are checked by the service against its definition. */
export class AiFeatureLimitsDto {
  @IsOptional()
  @IsInt()
  maxWords?: number;

  @IsOptional()
  @IsInt()
  concurrentBuilds?: number;
}

export class UpdateAiFeatureDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Required the first time the feature turns on: the admin read what is sent to the provider. */
  @IsOptional()
  @IsBoolean()
  confirmPrivacy?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => AiFeatureLimitsDto)
  limits?: AiFeatureLimitsDto;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_DOLLARS)
  monthlyBudget?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_BUILDS_PER_MONTH)
  buildsPerMonth?: number | null;

  /** Dollars a month one reader may spend; only for a feature readers use directly. */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_DOLLARS)
  readerMonthlyBudget?: number | null;

  /** Requests a month one reader may make when the feature's slots have no prices. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_BUILDS_PER_MONTH)
  readerRequestsPerMonth?: number | null;
}

export class UpdateAiBudgetDto {
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_DOLLARS)
  monthlyBudget?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_BUILDS_PER_MONTH)
  buildsPerMonth?: number | null;
}

export class AiTryDto {
  @IsIn(AI_SLOTS)
  slot!: AiSlot;
}

export class AiUsageQueryDto {
  @IsOptional()
  @Matches(MONTH, { message: 'from must be a month as YYYY-MM' })
  from?: string;

  @IsOptional()
  @Matches(MONTH, { message: 'to must be a month as YYYY-MM' })
  to?: string;
}
