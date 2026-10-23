import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min, ValidateNested } from 'class-validator';
import type { BookRequestPairHalfPayload } from '@bookorbit/types';

import { BookRequestWorkDto } from './create-book-request.dto';

/** The part of a pair one medium decides for itself. */
export class BookRequestPairHalfDto implements BookRequestPairHalfPayload {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetLibraryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetFolderId?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  preferredFormats?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false }, { message: 'coverUrl must be an http or https address' })
  coverUrl?: string;
}

export class CreateBookRequestPairDto extends BookRequestWorkDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BookRequestPairHalfDto)
  ebook?: BookRequestPairHalfDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BookRequestPairHalfDto)
  audiobook?: BookRequestPairHalfDto;
}
