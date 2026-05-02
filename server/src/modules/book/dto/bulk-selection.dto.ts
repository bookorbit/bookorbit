import { ArrayNotEmpty, IsArray, IsInt, IsOptional, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BulkQuerySelectionDto } from './bulk-query-selection.dto';

/**
 * Selection DTO used by all bulk book operations.
 *
 * Exactly one of `bookIds` or `query` must be provided:
 * - `bookIds` - explicit list of book IDs (standard selection)
 * - `query`   - filter/scope that is resolved to IDs server-side at execution time
 *               (used for cross-page "select all N matching books" mode)
 */
export class BulkSelectionDto {
  @ValidateIf((dto: BulkSelectionDto) => !dto.query)
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  bookIds?: number[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BulkQuerySelectionDto)
  query?: BulkQuerySelectionDto;
}
