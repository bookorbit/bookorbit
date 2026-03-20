import { Transform } from 'class-transformer';
import { IsInt, IsNumber, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class SaveProgressDto {
  @ValidateIf((o: SaveProgressDto) => o.cfi != null)
  @IsString()
  cfi?: string | null;

  @ValidateIf((o: SaveProgressDto) => o.pageNumber != null)
  @IsInt()
  pageNumber?: number | null;

  @IsNumber()
  @Min(0)
  @Max(100)
  percentage!: number;

  @ValidateIf((o: SaveProgressDto) => o.eventKey != null)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  eventKey?: string | null;

  @ValidateIf((o: SaveProgressDto) => o.source != null)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(40)
  source?: string | null;
}
