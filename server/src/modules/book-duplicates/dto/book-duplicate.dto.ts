import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BOOK_DUPLICATE_MATCH_REASONS, type BookDuplicateMatchReason } from '@bookorbit/types';

export class CreateBookDuplicateScanDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  libraryId?: number;

  @IsInt()
  @Min(70)
  @Max(100)
  similarityPercent!: number;
}

export class ListBookDuplicateGroupsDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;

  @IsOptional()
  @IsIn(BOOK_DUPLICATE_MATCH_REASONS)
  reason?: BookDuplicateMatchReason;
}
