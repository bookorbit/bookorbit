import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, Min, Max } from 'class-validator';

export class ListMissingResourcesDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

export class MissingResourceCleanupDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  bookIds?: number[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;
}
