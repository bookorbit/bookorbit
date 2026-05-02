import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export const METADATA_EXPORT_COLUMN_MODES = ['canonical', 'visible'] as const;
export type MetadataExportColumnMode = (typeof METADATA_EXPORT_COLUMN_MODES)[number];

export class MetadataExportOptionsDto {
  @IsOptional()
  @IsBoolean()
  includePersonalData?: boolean;

  @IsOptional()
  @IsBoolean()
  includeFilePaths?: boolean;

  @IsOptional()
  @IsBoolean()
  includeContextMeta?: boolean;

  @IsOptional()
  @IsIn(METADATA_EXPORT_COLUMN_MODES)
  columnsMode?: MetadataExportColumnMode;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  visibleColumns?: string[];
}
