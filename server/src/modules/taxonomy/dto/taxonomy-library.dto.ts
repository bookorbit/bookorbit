import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/** Narrows a genre or tag page to one library the viewer can open. */
export class TaxonomyLibraryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  libraryId?: number;
}
