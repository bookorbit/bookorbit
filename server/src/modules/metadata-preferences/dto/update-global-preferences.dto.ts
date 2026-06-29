import {
  ArrayMaxSize,
  IsIn,
  IsBoolean,
  IsArray,
  IsString,
  MaxLength,
  IsOptional,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  validateSync,
} from 'class-validator';
import { plainToInstance, Type } from 'class-transformer';
import { ALL_METADATA_FIELDS, GENRE_MERGE_MODES, MERGE_STRATEGIES, MetadataProviderKey } from '@bookorbit/types';
import type { GenreMergeMode, MergeStrategy, MetadataField } from '@bookorbit/types';
const PROVIDER_KEYS = Object.values(MetadataProviderKey);

export class FieldPreferenceDto {
  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsIn(PROVIDER_KEYS, { each: true })
  providers!: MetadataProviderKey[];

  @IsIn(MERGE_STRATEGIES)
  mergeStrategy!: MergeStrategy;
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
}

export class MetadataFetchOptionsDto {
  @ValidateNested()
  @Type(() => GenreOptionsDto)
  genres!: GenreOptionsDto;

  @IsBoolean()
  saveProviderIds!: boolean;
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
