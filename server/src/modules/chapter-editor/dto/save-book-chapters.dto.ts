import { AUDIOBOOK_CHAPTER_LIMITS, type SaveBookChaptersRequest } from '@bookorbit/types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class EditorChapterDto {
  @IsString()
  @MaxLength(AUDIOBOOK_CHAPTER_LIMITS.maxTitleLength)
  title!: string;

  @IsInt()
  @Min(0)
  startMs!: number;
}

export class SaveBookChaptersDto implements SaveBookChaptersRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AUDIOBOOK_CHAPTER_LIMITS.maxChapters)
  @ValidateNested({ each: true })
  @Type(() => EditorChapterDto)
  chapters!: EditorChapterDto[];

  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  baseRevision!: string;

  @IsOptional()
  @IsBoolean()
  lock?: boolean;
}
