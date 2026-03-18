import { Transform, Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional } from 'class-validator';

export class StatisticsFilterQueryDto {
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : value != null ? [value] : []))
  @Type(() => Number)
  @IsArray()
  @IsInt({ each: true })
  libraryIds?: number[];
}
