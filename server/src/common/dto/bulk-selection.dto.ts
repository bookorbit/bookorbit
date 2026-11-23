import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Min, ValidateIf, ValidateNested } from 'class-validator';

import type { GroupRule, SortSpec } from '@bookorbit/types';

export class BulkQuerySelectionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  libraryId?: number;

  @IsOptional()
  @IsObject()
  filter?: GroupRule;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  sort?: SortSpec[];

  /**
   * The listing folds linked editions: act on the edition each card shows, not on every matching
   * edition. Released clients never send it.
   */
  @IsOptional()
  @IsBoolean()
  collapseLinked?: boolean;
}

/**
 * Selection DTO shared by bulk operations that can target either explicit book
 * IDs or the current "all matching books" query selection.
 */
export class BulkSelectionDto {
  @ValidateIf((dto: BulkSelectionDto) => !dto.query)
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  bookIds?: number[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BulkQuerySelectionDto)
  query?: BulkQuerySelectionDto;
}
