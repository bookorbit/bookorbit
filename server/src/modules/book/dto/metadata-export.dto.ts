import { Type } from 'class-transformer';
import { IsArray, IsIn, IsObject, IsOptional, ValidateNested } from 'class-validator';
import type { SortSpec } from '@bookorbit/types';
import { BulkSelectionDto } from './bulk-selection.dto';
import { MetadataExportOptionsDto } from './metadata-export-options.dto';

export const METADATA_EXPORT_FORMATS = ['csv', 'json'] as const;
export type MetadataExportFormat = (typeof METADATA_EXPORT_FORMATS)[number];

export const METADATA_EXPORT_VIEW_TYPES = ['library', 'collection', 'smartScope'] as const;
export type MetadataExportViewType = (typeof METADATA_EXPORT_VIEW_TYPES)[number];

export class MetadataExportDto extends BulkSelectionDto {
  @IsIn(METADATA_EXPORT_FORMATS)
  format!: MetadataExportFormat;

  @IsOptional()
  @ValidateNested()
  @Type(() => MetadataExportOptionsDto)
  options?: MetadataExportOptionsDto;

  @IsOptional()
  @IsIn(METADATA_EXPORT_VIEW_TYPES)
  viewType?: MetadataExportViewType;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  sort?: SortSpec[];
}
