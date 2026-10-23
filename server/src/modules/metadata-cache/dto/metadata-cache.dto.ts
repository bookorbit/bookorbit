import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { METADATA_CACHE_LIMITS, METADATA_CACHE_NAMESPACES, type MetadataCacheNamespace } from '@bookorbit/types';

const L = METADATA_CACHE_LIMITS;

export class MetadataCacheProviderOverrideDto {
  @IsIn(METADATA_CACHE_NAMESPACES)
  namespace!: MetadataCacheNamespace;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  provider!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(L.resultsTtlSeconds.min)
  @Max(L.resultsTtlSeconds.max)
  resultsTtlSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(L.emptyTtlSeconds.min)
  @Max(L.emptyTtlSeconds.max)
  emptyTtlSeconds?: number;
}

export class UpdateMetadataCacheConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(L.resultsTtlSeconds.min)
  @Max(L.resultsTtlSeconds.max)
  resultsTtlSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(L.emptyTtlSeconds.min)
  @Max(L.emptyTtlSeconds.max)
  emptyTtlSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(L.staleGraceSeconds.min)
  @Max(L.staleGraceSeconds.max)
  staleGraceSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(L.maxStorageMb.min)
  @Max(L.maxStorageMb.max)
  maxStorageMb?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(L.maxProviderOverrides)
  @ValidateNested({ each: true })
  @Type(() => MetadataCacheProviderOverrideDto)
  providerOverrides?: MetadataCacheProviderOverrideDto[];
}

export class ClearMetadataCacheQueryDto {
  @IsOptional()
  @IsIn(METADATA_CACHE_NAMESPACES)
  namespace?: MetadataCacheNamespace;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  provider?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  emptyOnly?: boolean;
}
