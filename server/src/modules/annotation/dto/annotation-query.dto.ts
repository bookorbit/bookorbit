import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

const SORT_BY_OPTIONS = ['position', 'createdAt'] as const;
const SORT_DIR_OPTIONS = ['asc', 'desc'] as const;

export class AnnotationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookFileId?: number;

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

  @IsOptional()
  @IsIn(SORT_BY_OPTIONS)
  sortBy?: 'position' | 'createdAt';

  @IsOptional()
  @IsIn(SORT_DIR_OPTIONS)
  sortDir?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  colors?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  chapter?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Only annotations that carry a note. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasNote?: boolean;

  /** Only annotations whose canonical position is not `exact`. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  needsReview?: boolean;
}
