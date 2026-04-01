import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export const CATALOG_QUERY_MAX_LENGTH = 500;

export class SearchCatalogQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(CATALOG_QUERY_MAX_LENGTH)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q: string = '';
}
