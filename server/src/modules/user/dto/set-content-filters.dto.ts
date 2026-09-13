import { IsArray, IsBoolean, IsInt, IsOptional } from 'class-validator';

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

  /** Lets books this user requested through the rules above. Omitted leaves the current setting. */
  @IsOptional()
  @IsBoolean()
  seeOwnRequestedBooks?: boolean;
}
