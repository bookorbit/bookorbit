import { IsIn, IsOptional } from 'class-validator';
import { BulkSelectionDto } from './bulk-selection.dto';

const ALLOWED_FIELDS = ['seriesName', 'publisher', 'language', 'publishedYear', 'authors', 'genres', 'tags', 'narrators'] as const;
export type BulkMetadataField = (typeof ALLOWED_FIELDS)[number];

export class BulkSetMetadataDto extends BulkSelectionDto {
  @IsIn(ALLOWED_FIELDS)
  field!: BulkMetadataField;

  @IsOptional()
  value?: string | number | string[] | null;
}
