import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { KoreaderAnnotationDto, PluginDeviceDto } from './koreader-plugin.dto';

const MD5_HEX = /^[0-9a-f]{32}$/i;
const DEVICE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export class ExchangeKeyDto {
  @IsString()
  @Matches(MD5_HEX)
  k!: string;

  @IsString()
  @Matches(DEVICE_DATETIME)
  dt!: string;
}

export class ExchangeBookDto {
  @IsString()
  @Matches(MD5_HEX)
  hash!: string;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ExchangeKeyDto)
  keys!: ExchangeKeyDto[];

  /** False when the device chunk-capped the key list; deletion detection is skipped then. */
  @IsBoolean()
  keysComplete!: boolean;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => KoreaderAnnotationDto)
  changes!: KoreaderAnnotationDto[];
}

export class AnnotationExchangeDto extends PluginDeviceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExchangeBookDto)
  books!: ExchangeBookDto[];
}

export class ExchangeAckAppliedDto {
  @IsInt()
  @Min(1)
  serverId!: number;

  @IsInt()
  @Min(1)
  version!: number;

  @IsIn(['applied', 'failed'])
  status!: 'applied' | 'failed';

  @IsOptional()
  @IsBoolean()
  verified?: boolean;

  @IsOptional()
  @IsBoolean()
  corrected?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  pos0?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  pos1?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  pageno?: number;

  @IsOptional()
  @IsString()
  @Matches(DEVICE_DATETIME)
  datetimeUpdated?: string;
}

export class ExchangeAckDeletedDto {
  @IsInt()
  @Min(1)
  serverId!: number;

  @IsIn(['applied', 'failed'])
  status!: 'applied' | 'failed';
}

export class ExchangeAckBookDto {
  @IsString()
  @Matches(MD5_HEX)
  hash!: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ExchangeAckAppliedDto)
  applied!: ExchangeAckAppliedDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ExchangeAckDeletedDto)
  deleted!: ExchangeAckDeletedDto[];
}

export class AnnotationExchangeAckDto extends PluginDeviceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExchangeAckBookDto)
  books!: ExchangeAckBookDto[];
}
