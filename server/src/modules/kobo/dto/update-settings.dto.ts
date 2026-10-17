import { READ_ALOUD_DELIVERY_VARIANTS, type ReadAloudDeliveryPreference } from '@bookorbit/types';
import { IsIn, IsNumber, IsOptional, IsInt, IsBoolean, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsIn(READ_ALOUD_DELIVERY_VARIANTS)
  readAloudDelivery?: ReadAloudDeliveryPreference;

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
  @IsBoolean()
  storeSync?: boolean;

  @IsOptional()
  @IsBoolean()
  fullSizeCovers?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  kepubConversionLimitMb?: number;
}
