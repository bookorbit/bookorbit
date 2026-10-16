import { IsIn, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class DjvuPageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1280, 1920, 2560])
  size: number = 1920;
}
