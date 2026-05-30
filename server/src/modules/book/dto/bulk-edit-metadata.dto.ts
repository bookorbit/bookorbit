import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BulkSelectionDto } from './bulk-selection.dto';

const ARRAY_MODES = ['add', 'remove', 'replace'] as const;
export type BulkArrayMode = (typeof ARRAY_MODES)[number];

export class BulkArrayFieldDto {
  @IsIn(ARRAY_MODES)
  mode!: BulkArrayMode;

  @IsArray()
  @IsString({ each: true })
  values!: string[];
}

export class BulkScalarStringFieldDto {
  @IsOptional()
  @IsString()
  value!: string | null;
}

export class BulkScalarNumberFieldDto {
  @IsOptional()
  @IsInt()
  value!: number | null;
}

const ALLOWED_FIELD_KEYS = new Set<string>(['authors', 'seriesName', 'genres', 'tags', 'publisher', 'language', 'publishedYear', 'narrators']);

export class BulkEditFieldsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkArrayFieldDto)
  authors?: BulkArrayFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BulkScalarStringFieldDto)
  seriesName?: BulkScalarStringFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BulkArrayFieldDto)
  genres?: BulkArrayFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BulkArrayFieldDto)
  tags?: BulkArrayFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BulkScalarStringFieldDto)
  publisher?: BulkScalarStringFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BulkScalarStringFieldDto)
  language?: BulkScalarStringFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BulkScalarNumberFieldDto)
  publishedYear?: BulkScalarNumberFieldDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BulkArrayFieldDto)
  narrators?: BulkArrayFieldDto;

  hasAtLeastOneField(): boolean {
    return Object.keys(this).some((k) => ALLOWED_FIELD_KEYS.has(k) && (this as Record<string, unknown>)[k] !== undefined);
  }

  hasOnlyAllowedKeys(rawInput: Record<string, unknown>): boolean {
    return Object.keys(rawInput).every((k) => ALLOWED_FIELD_KEYS.has(k));
  }

  hasValidArrayValues(): boolean {
    for (const key of ['authors', 'genres', 'tags', 'narrators'] as const) {
      const field = this[key];
      if (!field) continue;
      if ((field.mode === 'add' || field.mode === 'remove') && (!field.values || field.values.length === 0)) {
        return false;
      }
    }
    return true;
  }
}

export { ALLOWED_FIELD_KEYS as BULK_EDIT_ALLOWED_FIELD_KEYS };

export class BulkEditMetadataDto extends BulkSelectionDto {
  @IsObject()
  @ValidateNested()
  @Type(() => BulkEditFieldsDto)
  fields!: BulkEditFieldsDto;
}
