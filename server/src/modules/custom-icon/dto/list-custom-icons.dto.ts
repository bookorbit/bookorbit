import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CUSTOM_ICON_MAX_PAGE_SIZE, CUSTOM_ICON_SORTS, type CustomIconSort } from '@bookorbit/types';

export class ListCustomIconsDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CUSTOM_ICON_MAX_PAGE_SIZE)
  size?: number;

  @IsOptional()
  @IsIn(CUSTOM_ICON_SORTS)
  sort?: CustomIconSort = 'newest';
}
