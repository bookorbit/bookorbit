import { IsArray, IsInt, IsOptional } from 'class-validator';

export class SetContentFiltersDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  includeTagIds?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludeTagIds?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  includeGenreIds?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludeGenreIds?: number[];
}
