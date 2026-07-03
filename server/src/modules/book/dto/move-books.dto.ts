import { IsInt, IsOptional, Min } from 'class-validator';

import { BulkSelectionDto } from './bulk-selection.dto';

export class MoveBooksDto extends BulkSelectionDto {
  @IsInt()
  @Min(1)
  targetLibraryId!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  targetFolderId?: number;
}
