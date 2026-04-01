import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import type { BookMetadataFetchConditions, BookMetadataFetchConfig, MetadataField } from '@projectx/types';

import { ALL_METADATA_FIELDS } from '@projectx/types';

class ScoreConditionDto {
  @IsBoolean()
  enabled: boolean;

  @IsInt()
  @Min(0)
  @Max(100)
  threshold: number;
}

class MissingFieldsConditionDto {
  @IsBoolean()
  enabled: boolean;

  @IsArray()
  @IsIn(ALL_METADATA_FIELDS, { each: true })
  fields: MetadataField[];
}

class NeverFetchedConditionDto {
  @IsBoolean()
  enabled: boolean;
}

class ConditionsDto implements BookMetadataFetchConditions {
  @ValidateNested()
  @Type(() => ScoreConditionDto)
  scoreThreshold: ScoreConditionDto;

  @ValidateNested()
  @Type(() => MissingFieldsConditionDto)
  missingFields: MissingFieldsConditionDto;

  @ValidateNested()
  @Type(() => NeverFetchedConditionDto)
  neverFetched: NeverFetchedConditionDto;
}

export class UpdateBookMetadataFetchConfigDto implements BookMetadataFetchConfig {
  @IsBoolean()
  enabled: boolean;

  @IsBoolean()
  triggerOnImport: boolean;

  @ValidateNested()
  @Type(() => ConditionsDto)
  conditions: ConditionsDto;
}

export class PreviewCountDto {
  @IsObject()
  @ValidateNested()
  @Type(() => ConditionsDto)
  conditions: BookMetadataFetchConditions;

  @IsOptional()
  @IsInt()
  libraryId?: number;
}

export class UpdateLibraryBookMetadataFetchConfigDto implements Partial<BookMetadataFetchConfig> {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  triggerOnImport?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConditionsDto)
  conditions?: BookMetadataFetchConditions;
}
