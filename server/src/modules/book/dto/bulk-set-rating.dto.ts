import { ArrayNotEmpty, IsArray, IsInt, IsOptional, Max, Min } from 'class-validator';

export class BulkSetRatingDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  bookIds: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;
}
