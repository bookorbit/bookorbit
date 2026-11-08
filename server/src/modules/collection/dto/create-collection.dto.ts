import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { COVER_ASPECT_RATIOS, ICON_VALUE_MAX_LENGTH, type CoverAspectRatio } from '@bookorbit/types';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateCollectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(ICON_VALUE_MAX_LENGTH)
  icon: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsIn(COVER_ASPECT_RATIOS)
  coverAspectRatio?: CoverAspectRatio;

  @IsOptional()
  @IsBoolean()
  syncToKobo?: boolean;
}
