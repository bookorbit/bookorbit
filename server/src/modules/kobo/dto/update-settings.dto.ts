import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  readingThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  finishedThreshold?: number;

  @IsOptional()
  @IsBoolean()
  convertToKepub?: boolean;

  @IsOptional()
  @IsBoolean()
  twoWayProgressSync?: boolean;

  @IsOptional()
  @IsBoolean()
  forceEnableHyphenation?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  kepubConversionLimitMb?: number;
}
