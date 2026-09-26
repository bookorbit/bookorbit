import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StaticVoiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(200)
  shortName!: string;

  @IsString()
  @MaxLength(100)
  language!: string;

  @IsString()
  @MaxLength(20)
  locale!: string;

  @IsString()
  @IsIn(['Male', 'Female', 'Unknown', ''])
  gender!: string;
}

export class AddTtsProviderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  baseUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultModel?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaticVoiceDto)
  staticVoices?: StaticVoiceDto[] | null;

  @IsOptional()
  @IsBoolean()
  supportsVoiceDiscovery?: boolean;
}

export class UpdateTtsProviderDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultModel?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaticVoiceDto)
  staticVoices?: StaticVoiceDto[] | null;

  @IsOptional()
  @IsBoolean()
  supportsVoiceDiscovery?: boolean;
}

export class ReorderTtsProvidersDto {
  /** Provider ids in their new order. */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Matches(/^\d+$/, { each: true })
  order!: string[];
}
