import {
  ArrayMaxSize,
  IsIn,
  IsBoolean,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  IsOptional,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  validateSync,
} from 'class-validator';
import { plainToInstance, Type } from 'class-transformer';
import {
  ALL_METADATA_FIELDS,
  GENRE_MERGE_MODES,
  GENRE_MERGE_STRATEGIES,
  MAX_METADATA_GENRE_COUNT,
  MetadataProviderKey,
  PROVIDER_ID_FETCH_MODES,
} from '@bookorbit/types';
import type { GenreMergeMode, MetadataField, MetadataMergeStrategy, ProviderIdFetchMode } from '@bookorbit/types';
const PROVIDER_KEYS = Object.values(MetadataProviderKey);

export class FieldPreferenceDto {
  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsIn(PROVIDER_KEYS, { each: true })
  providers!: MetadataProviderKey[];

  @IsIn(GENRE_MERGE_STRATEGIES)
  mergeStrategy!: MetadataMergeStrategy;
}

export class GenreOptionsDto {
  @IsIn(GENRE_MERGE_MODES)
  mode!: GenreMergeMode;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  blocklist!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_METADATA_GENRE_COUNT)
  maxCount: number | null = null;
}

export class MetadataFetchOptionsDto {
  @ValidateNested()
  @Type(() => GenreOptionsDto)
  genres!: GenreOptionsDto;

  @IsBoolean()
  saveProviderIds!: boolean;

  @IsIn(PROVIDER_ID_FETCH_MODES)
  providerIdMode!: ProviderIdFetchMode;
}

@ValidatorConstraint({ name: 'isFieldPreferencesMap', async: false })
export class IsFieldPreferencesMapConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const knownFields = new Set<string>(ALL_METADATA_FIELDS);
    for (const [field, v] of Object.entries(value as Record<string, unknown>)) {
      if (!knownFields.has(field)) return false;
      const instance = plainToInstance(FieldPreferenceDto, v);
      if (validateSync(instance).length > 0) return false;
      if (field !== 'genres' && instance.mergeStrategy === 'mergeExisting') return false;
    }
    return true;
  }
  defaultMessage(): string {
    return 'fields must be a valid map of field preferences';
  }
}

export class UpdateGlobalPreferencesDto {
  @Validate(IsFieldPreferencesMapConstraint)
  fields!: Record<MetadataField, FieldPreferenceDto>;

  @IsOptional()
  @ValidateNested()
  @Type(() => MetadataFetchOptionsDto)
  options?: MetadataFetchOptionsDto;
}
