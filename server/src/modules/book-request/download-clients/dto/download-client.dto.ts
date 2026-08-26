import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  Max,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DOWNLOAD_CLIENT_TYPES, INDEXER_COLORS } from '@bookorbit/types';
import type { DownloadClientType, IndexerColor } from '@bookorbit/types';

export class DownloadClientPathMappingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  remotePath!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  localPath!: string;
}

export class CreateDownloadClientDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsIn(INDEXER_COLORS)
  color?: IndexerColor | null;

  @IsIn(DOWNLOAD_CLIENT_TYPES)
  adapterType!: DownloadClientType;

  @IsString()
  @MaxLength(2048)
  baseUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  password?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  priority?: number;

  /** Isolates our torrents in the client, so BookOrbit only ever acts on rows it created. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[\w .-]*$/, { message: 'category may only contain letters, numbers, spaces, dots, dashes and underscores' })
  category?: string;

  @IsOptional()
  @IsBoolean()
  useHardlinks?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPrivateAddress?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DownloadClientPathMappingDto)
  pathMappings?: DownloadClientPathMappingDto[];
}

/**
 * Spelled out rather than derived from the create DTO: `whitelist` plus `forbidNonWhitelisted`
 * means the accepted field list has to be exact, and an inherited-then-loosened field is easy to
 * get subtly wrong.
 */
export class UpdateDownloadClientDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(INDEXER_COLORS)
  color?: IndexerColor | null;

  @IsOptional()
  @IsIn(DOWNLOAD_CLIENT_TYPES)
  adapterType?: DownloadClientType;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  /** An omitted password keeps the stored one; an empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  password?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[\w .-]*$/, { message: 'category may only contain letters, numbers, spaces, dots, dashes and underscores' })
  category?: string;

  @IsOptional()
  @IsBoolean()
  useHardlinks?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPrivateAddress?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DownloadClientPathMappingDto)
  pathMappings?: DownloadClientPathMappingDto[];
}

/**
 * A stored mapping rather than a path the caller names. The probe writes, links and unlinks at the
 * directory it is given, so accepting an arbitrary path made this an arbitrary-directory write and
 * existence oracle; the id can only ever select a directory an operator already configured.
 */
export class TestPathMappingDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  mappingId!: number;
}
