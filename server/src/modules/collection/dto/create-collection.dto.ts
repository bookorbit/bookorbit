import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, IsIn } from 'class-validator';
import { ICON_VALUE_MAX_LENGTH, MEDIA_TYPES, type MediaType } from '@bookorbit/types';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateCollectionDto {
  /** Defaults to books, so existing callers need no change. */
  @IsOptional()
  @IsIn(MEDIA_TYPES)
  mediaType?: MediaType;

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
  @IsBoolean()
  syncToKobo?: boolean;
}
