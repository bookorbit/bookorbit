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

  @ValidateIf((o: SaveProgressDto) => o.koboLocationSource != null)
  @IsString()
  koboLocationSource?: string | null;

  @ValidateIf((o: SaveProgressDto) => o.koboLocationType != null)
  @IsString()
  koboLocationType?: string | null;

  @ValidateIf((o: SaveProgressDto) => o.koboLocationValue != null)
  @IsString()
  koboLocationValue?: string | null;

  @ValidateIf((o: SaveProgressDto) => o.koreaderProgress != null)
  @IsString()
  koreaderProgress?: string | null;

  @IsOptional()
  @ValidateIf((o: SaveProgressDto) => o.koboContentSourceProgressPercent != null)
  @IsNumber()
  @Min(0)
  @Max(100)
  koboContentSourceProgressPercent?: number | null;
}
