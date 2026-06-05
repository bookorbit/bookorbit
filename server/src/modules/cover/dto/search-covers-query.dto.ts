import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { COVER_PROVIDER_ALL_KEY, COVER_PROVIDER_KEYS, type CoverSearchProvider } from '../providers/cover-provider';

const COVER_SEARCH_PROVIDER_VALUES = [...COVER_PROVIDER_KEYS, COVER_PROVIDER_ALL_KEY] as const;

function trimQueryString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function parseBooleanQueryValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === true || value === false) return value;
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return value;
}

export class SearchCoversQueryDto {
  @Transform(({ value }) => trimQueryString(value))
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @Transform(({ value }) => trimQueryString(value))
  @IsString()
  author?: string;

  @IsOptional()
  @Transform(({ value }) => parseBooleanQueryValue(value))
  @IsBoolean()
  isAudiobook?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(COVER_SEARCH_PROVIDER_VALUES)
  provider?: CoverSearchProvider;
}
