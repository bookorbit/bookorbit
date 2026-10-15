import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/**
 * Which of a file's two positions this write moved. Text is the default so a client that predates
 * the field, or one that has only ever had a text position, keeps its current behaviour.
 */
export const PROGRESS_SOURCES = ['text', 'narration'] as const;
export type ProgressSource = (typeof PROGRESS_SOURCES)[number];

export class SaveProgressDto {
  @IsOptional()
  @IsIn(PROGRESS_SOURCES)
  source?: ProgressSource;

  // Each string is held to its column, so an oversized one is a 400 rather than a database error.
  @ValidateIf((o: SaveProgressDto) => o.cfi != null)
  @IsString()
  @MaxLength(2000)
  cfi?: string | null;

  @ValidateIf((o: SaveProgressDto) => o.pageNumber != null)
  @IsInt()
  @Min(0)
  @Max(2147483647)
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

  @ValidateIf((o: SaveProgressDto) => o.mediaOverlayFragment != null)
  @IsString()
  @MaxLength(4096)
  mediaOverlayFragment?: string | null;

  @IsOptional()
  @ValidateIf((o: SaveProgressDto) => o.mediaOverlaySectionIndex != null)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  mediaOverlaySectionIndex?: number | null;

  @ValidateIf((o: SaveProgressDto) => o.koboLocationSource != null)
  @IsString()
  @MaxLength(4096)
  koboLocationSource?: string | null;

  @ValidateIf((o: SaveProgressDto) => o.koboLocationType != null)
  @IsString()
  @MaxLength(64)
  koboLocationType?: string | null;

  @ValidateIf((o: SaveProgressDto) => o.koboLocationValue != null)
  @IsString()
  @MaxLength(255)
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
