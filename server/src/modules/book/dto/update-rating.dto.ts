import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateRatingDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;
}
