import { CHAPTER_HEALTH_CATEGORIES, type ChapterHealthCategory, type EnqueueChapterLookupRequest } from '@bookorbit/types';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ChapterHealthScopeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  libraryId?: number;
}

export class ChapterHealthListDto extends ChapterHealthScopeDto {
  @IsIn(CHAPTER_HEALTH_CATEGORIES)
  category!: ChapterHealthCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class EnqueueChapterLookupDto implements EnqueueChapterLookupRequest {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  bookIds?: number[];

  @IsOptional()
  @IsIn(CHAPTER_HEALTH_CATEGORIES)
  category?: ChapterHealthCategory;

  @IsOptional()
  @IsInt()
  @Min(1)
  libraryId?: number;
}
