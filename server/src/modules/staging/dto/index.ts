import { IsArray, IsBoolean, IsInt, IsNumber, IsObject, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { StagingMetadata } from '@projectx/types';

export class UpdateStagingFileDto {
  @IsOptional()
  @IsObject()
  selectedMetadata?: Partial<StagingMetadata>;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  targetLibraryId?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  targetFolderId?: number | null;
}

class FinalizeOverrideDto {
  @IsInt()
  fileId: number;

  @IsOptional()
  @IsInt()
  libraryId?: number;

  @IsOptional()
  @IsInt()
  folderId?: number;
}

export class FinalizeStagingDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];

  @IsInt()
  defaultLibraryId: number;

  @IsInt()
  defaultFolderId: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FinalizeOverrideDto)
  overrides?: FinalizeOverrideDto[];
}

export class BulkDiscardDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];
}

export class PreviewNamesDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];

  @IsInt()
  defaultLibraryId: number;
}

export class BulkRetryFetchDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];
}

export class BulkApplyFetchedDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];
}

export class StagingMetadataFieldsDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() publisher?: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsString() isbn10?: string;
  @IsOptional() @IsString() isbn13?: string;
  @IsOptional() @IsString() seriesName?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsNumber() publishedYear?: number;
  @IsOptional() @IsNumber() pageCount?: number;
  @IsOptional() @IsNumber() seriesIndex?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) authors?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) genres?: string[];
}

export class BulkEditStagingDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];

  @ValidateNested()
  @Type(() => StagingMetadataFieldsDto)
  fields: StagingMetadataFieldsDto;

  @IsArray()
  @IsString({ each: true })
  enabledFields: string[];

  @IsBoolean()
  mergeArrays: boolean;
}
