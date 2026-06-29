import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsObject, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import type {
  BookMetadataFetchConditions,
  BookMetadataFetchConditionsOverride,
  BookMetadataFetchConfig,
  BookMetadataFetchConfigOverride,
  MetadataField,
} from '@bookorbit/types';

import { ALL_METADATA_FIELDS } from '@bookorbit/types';

export class ScoreConditionDto {
  @IsDefined()
  @IsBoolean()
  enabled: boolean;

  @IsDefined()
  @IsInt()
  @Min(0)
  @Max(100)
  threshold: number;
}

export class MissingFieldsConditionDto {
  @IsDefined()
  @IsBoolean()
  enabled: boolean;

  @IsDefined()
  @IsArray()
  @IsIn(ALL_METADATA_FIELDS, { each: true })
  fields: MetadataField[];
}

export class NeverFetchedConditionDto {
  @IsDefined()
  @IsBoolean()
  enabled: boolean;
}

export class ConditionsDto implements BookMetadataFetchConditions {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ScoreConditionDto)
  scoreThreshold: ScoreConditionDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => MissingFieldsConditionDto)
  missingFields: MissingFieldsConditionDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => NeverFetchedConditionDto)
  neverFetched: NeverFetchedConditionDto;
}

export class ScoreConditionOverrideDto implements Partial<ScoreConditionDto> {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  threshold?: number;
}

export class MissingFieldsConditionOverrideDto implements Partial<MissingFieldsConditionDto> {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsIn(ALL_METADATA_FIELDS, { each: true })
  fields?: MetadataField[];
}

export class NeverFetchedConditionOverrideDto implements Partial<NeverFetchedConditionDto> {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ConditionsOverrideDto implements BookMetadataFetchConditionsOverride {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ScoreConditionOverrideDto)
  scoreThreshold?: ScoreConditionOverrideDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MissingFieldsConditionOverrideDto)
  missingFields?: MissingFieldsConditionOverrideDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NeverFetchedConditionOverrideDto)
  neverFetched?: NeverFetchedConditionOverrideDto;
}

export class UpdateBookMetadataFetchConfigDto implements BookMetadataFetchConfig {
  @IsDefined()
  @IsBoolean()
  enabled: boolean;

  @IsDefined()
  @IsBoolean()
  triggerOnImport: boolean;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ConditionsDto)
  conditions: ConditionsDto;
}

export class PreviewCountDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ConditionsDto)
  conditions: BookMetadataFetchConditions;

  @IsOptional()
  @IsInt()
  libraryId?: number;
}

export class UpdateLibraryBookMetadataFetchConfigDto implements NonNullable<BookMetadataFetchConfigOverride> {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  triggerOnImport?: boolean;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ConditionsOverrideDto)
  conditions?: BookMetadataFetchConditionsOverride;
}
