import { IsArray, IsBoolean, IsIn, IsString, Validate, ValidatorConstraint, ValidatorConstraintInterface, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ALL_AUTHOR_METADATA_FIELDS, AuthorMetadataProviderKey, MERGE_STRATEGIES } from '@bookorbit/types';
import type { AuthorMetadataField, MergeStrategy } from '@bookorbit/types';

const PROVIDER_KEYS = Object.values(AuthorMetadataProviderKey);

export class AuthorFieldPreferenceDto {
  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsIn(PROVIDER_KEYS, { each: true })
  providers!: AuthorMetadataProviderKey[];

  @IsIn(MERGE_STRATEGIES)
  mergeStrategy!: MergeStrategy;
}

@ValidatorConstraint({ name: 'isAuthorFieldPreferencesMap', async: false })
export class IsAuthorFieldPreferencesMapConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const knownFields = new Set<string>(ALL_AUTHOR_METADATA_FIELDS);
    for (const [field, preference] of Object.entries(value as Record<string, unknown>)) {
      if (!knownFields.has(field)) return false;
      if (validateSync(plainToInstance(AuthorFieldPreferenceDto, preference)).length > 0) return false;
    }
    return true;
  }

  defaultMessage(): string {
    return 'fields must be a valid map of author field preferences';
  }
}

export class UpdateAuthorMetadataPreferencesDto {
  @Validate(IsAuthorFieldPreferencesMapConstraint)
  fields!: Record<AuthorMetadataField, AuthorFieldPreferenceDto>;
}
