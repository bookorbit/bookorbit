import { IsNumber, IsOptional, IsInt, IsBoolean, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(10)
  readingThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(75)
  @Max(100)
  finishedThreshold?: number;

  @IsOptional()
  @IsBoolean()
  convertToKepub?: boolean;

  @IsOptional()
  @IsBoolean()
  forceEnableHyphenation?: boolean;

  @IsOptional()
  @IsBoolean()
  twoWayProgressSync?: boolean;

  @IsOptional()
  @IsBoolean()
  syncBookOrbitAnnotationsToKobo?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  kepubConversionLimitMb?: number;
}
