import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class SaveProgressDto {
  @IsOptional()
  @IsString()
  cfi?: string | null;

  @IsOptional()
  @IsInt()
  pageNumber?: number | null;

  @IsNumber()
  @Min(0)
  @Max(100)
  percentage!: number;
}
