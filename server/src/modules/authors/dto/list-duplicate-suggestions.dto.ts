import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class ListDuplicateSuggestionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  libraryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(600)
  poolSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(1)
  minConfidence?: number;
}
