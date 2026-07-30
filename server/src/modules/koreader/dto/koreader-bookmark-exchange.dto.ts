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

import { PluginDeviceDto } from './koreader-plugin.dto';

const MD5_HEX = /^[0-9a-f]{32}$/i;
const DEVICE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export const BOOKMARK_EXCHANGE_MAX_BOOKS = 20;
export const BOOKMARK_EXCHANGE_MAX_KEYS = 500;
export const BOOKMARK_EXCHANGE_MAX_CHANGES = 50;

export class BookmarkExchangeKeyDto {
  @IsString()
  @Matches(MD5_HEX)
  k!: string;

  @IsString()
  @Matches(DEVICE_DATETIME)
  dt!: string;
}

/** One position-only bookmark (dogear) as KOReader stores it on a rolling document. */
export class KoreaderBookmarkDto {
  @IsString()
  @Matches(DEVICE_DATETIME)
  datetime!: string;

  @IsOptional()
  @IsString()
  @Matches(DEVICE_DATETIME)
  datetimeUpdated?: string;

  @IsString()
  @MaxLength(4000)
  pos!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  pageno?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  chapter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class BookmarkExchangeBookDto {
  @IsString()
  @Matches(MD5_HEX)
  hash!: string;

  @IsArray()
  @ArrayMaxSize(BOOKMARK_EXCHANGE_MAX_KEYS)
  @ValidateNested({ each: true })
  @Type(() => BookmarkExchangeKeyDto)
  keys!: BookmarkExchangeKeyDto[];

  /** False when the device chunk-capped the key list; deletion detection is skipped then. */
  @IsBoolean()
  keysComplete!: boolean;

  @IsArray()
  @ArrayMaxSize(BOOKMARK_EXCHANGE_MAX_CHANGES)
  @ValidateNested({ each: true })
  @Type(() => KoreaderBookmarkDto)
  changes!: KoreaderBookmarkDto[];
}

export class BookmarkExchangeDto extends PluginDeviceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BOOKMARK_EXCHANGE_MAX_BOOKS)
  @ValidateNested({ each: true })
  @Type(() => BookmarkExchangeBookDto)
  books!: BookmarkExchangeBookDto[];
}

export class BookmarkAckAppliedDto {
  @IsInt()
  @Min(1)
  serverId!: number;

  @IsIn(['applied', 'failed'])
  status!: 'applied' | 'failed';

  /** Local identity the device gave the applied bookmark; without it nothing links. */
  @IsOptional()
  @IsString()
  @Matches(MD5_HEX)
  key?: string;

  @IsOptional()
  @IsString()
  @Matches(DEVICE_DATETIME)
  datetime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  pos?: string;
}

export class BookmarkAckDeletedDto {
  @IsInt()
  @Min(1)
  serverId!: number;

  @IsIn(['applied', 'failed'])
  status!: 'applied' | 'failed';
}

export class BookmarkAckBookDto {
  @IsString()
  @Matches(MD5_HEX)
  hash!: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BookmarkAckAppliedDto)
  applied!: BookmarkAckAppliedDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BookmarkAckDeletedDto)
  deleted!: BookmarkAckDeletedDto[];
}

export class BookmarkExchangeAckDto extends PluginDeviceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BOOKMARK_EXCHANGE_MAX_BOOKS)
  @ValidateNested({ each: true })
  @Type(() => BookmarkAckBookDto)
  books!: BookmarkAckBookDto[];
}
