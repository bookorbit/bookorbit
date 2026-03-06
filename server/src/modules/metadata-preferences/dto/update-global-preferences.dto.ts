import { IsIn, IsBoolean, IsArray, IsString, Validate, ValidatorConstraint, ValidatorConstraintInterface, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ALL_METADATA_FIELDS, MetadataProviderKey } from '@projectx/types';
import type { MetadataField, MergeStrategy } from '@projectx/types';

const MERGE_STRATEGIES: MergeStrategy[] = ['fillMissing', 'overwrite', 'overwriteIfProvided'];
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

@ValidatorConstraint({ name: 'isFieldPreferencesMap', async: false })
class IsFieldPreferencesMapConstraint implements ValidatorConstraintInterface {
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
}
