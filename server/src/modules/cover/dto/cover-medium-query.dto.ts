import { COVER_IMAGE_SIZES, COVER_MEDIA, type CoverImageSize, type CoverMedium } from '@bookorbit/types';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class CoverMediumQueryDto {
  @IsOptional()
  @IsIn(COVER_MEDIA)
  medium?: CoverMedium;
}

export class CoverReadQueryDto extends CoverMediumQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  strict?: boolean;

  @IsOptional()
  t?: string;
}

export class CoverImageQueryDto extends CoverReadQueryDto {
  @IsOptional()
  @IsIn(COVER_IMAGE_SIZES)
  size?: CoverImageSize;
}
