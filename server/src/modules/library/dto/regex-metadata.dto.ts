import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  REGEX_METADATA_LIMITS,
  REGEX_METADATA_PRESETS,
  type RegexMetadataConfig,
  type RegexMetadataPreset,
  type RegexMetadataRule,
} from '@bookorbit/types';

export class RegexMetadataRuleDto implements RegexMetadataRule {
  @IsString()
  @MinLength(1)
  @MaxLength(REGEX_METADATA_LIMITS.patternLength)
  pattern: string;

  @IsString()
  @Matches(/^(?:i?u?|ui)$/)
  flags: string;
}

export class RegexMetadataConfigDto implements RegexMetadataConfig {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(REGEX_METADATA_LIMITS.rules)
  @ValidateNested({ each: true })
  @Type(() => RegexMetadataRuleDto)
  rules: RegexMetadataRuleDto[];

  @IsOptional()
  @IsIn(REGEX_METADATA_PRESETS)
  preset?: RegexMetadataPreset;
}

export class RegexMetadataValidationDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RegexMetadataConfigDto)
  config: RegexMetadataConfigDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  libraryId?: number;
}

export class RegexMetadataPreviewDto extends RegexMetadataValidationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(REGEX_METADATA_LIMITS.pathLength)
  relativePath: string;
}
