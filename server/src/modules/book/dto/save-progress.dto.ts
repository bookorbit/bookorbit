import { IsIn, IsNumber, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

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

  @ValidateIf((o: SaveProgressDto) => o.mediaOverlayFragment != null)
  @IsString()
  mediaOverlayFragment?: string | null;

  @IsOptional()
  @ValidateIf((o: SaveProgressDto) => o.mediaOverlaySectionIndex != null)
  @IsNumber()
  @Min(0)
  mediaOverlaySectionIndex?: number | null;

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
