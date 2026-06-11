import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { ANNOTATION_STYLES } from '../annotation.constants';

export class AnnotationHubQueryDto {
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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  chapter?: string;

  /** Comma-separated hex colors. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  colors?: string;

  /** Comma-separated styles. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  styles?: string;

  /** Comma-separated origins (web, koreader, kobo). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  origins?: string;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsIn(['active', 'trashed'])
  status?: 'active' | 'trashed';

  @IsOptional()
  @IsIn(['createdAt', 'book'])
  sortBy?: 'createdAt' | 'book';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}

export class AnnotationExportQueryDto extends AnnotationHubQueryDto {
  @IsOptional()
  @IsIn(['md', 'csv', 'json'])
  format?: 'md' | 'csv' | 'json';
}

export class AnnotationBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids!: number[];

  @IsIn(['trash', 'restore', 'restyle'])
  action!: 'trash' | 'restore' | 'restyle';

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }) => (value === '' ? undefined : (value as string)))
  color?: string;

  @IsOptional()
  @IsIn(ANNOTATION_STYLES)
  style?: string;
}
