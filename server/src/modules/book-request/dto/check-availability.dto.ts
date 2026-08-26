import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { BOOK_REQUEST_MEDIA_KINDS } from '@bookorbit/types';
import type { BookRequestMediaKind } from '@bookorbit/types';

export class AvailabilityQueryDto {
  @IsString()
  @MaxLength(500)
  title!: string;

  @IsIn(BOOK_REQUEST_MEDIA_KINDS)
  mediaKind!: BookRequestMediaKind;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  author?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  isbn13?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  providerKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerId?: string;
}

export class CheckAvailabilityDto {
  /** Capped at one screenful of search results; this is an annotation pass, not a bulk query. */
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityQueryDto)
  items!: AvailabilityQueryDto[];
}
