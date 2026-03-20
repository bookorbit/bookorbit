import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UserDailyReadingQueryDto {
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : value != null ? [value] : []))
  @Type(() => Number)
  @IsArray()
  @IsInt({ each: true })
  libraryIds?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value == null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const normalized = String(value).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  })
  @IsBoolean()
  comparePrevious?: boolean;
}
