import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { BulkSelectionDto } from './bulk-selection.dto';

export class BulkSetRatingDto extends BulkSelectionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;
}
