import { IsNumber, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

export class SaveProgressDto {
  @ValidateIf((o: SaveProgressDto) => o.cfi != null)
  @IsString()
  cfi?: string | null;

  @ValidateIf((o: SaveProgressDto) => o.pageNumber != null)
  @IsNumber()
  pageNumber?: number | null;

  @IsNumber()
  @Min(0)
  @Max(100)
  percentage!: number;

  @IsOptional()
  @ValidateIf((o: SaveProgressDto) => o.positionSeconds != null)
  @IsNumber()
  @Min(0)
  positionSeconds?: number | null;
}
