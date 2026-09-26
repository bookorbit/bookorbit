import { COVER_MEDIA, type CoverMedium } from '@bookorbit/types';
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
