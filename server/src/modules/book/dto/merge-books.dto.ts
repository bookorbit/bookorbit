import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class MergeBooksDto {
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  @ArrayMaxSize(100)
  sourceBookIds!: number[];

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  targetBookId!: number;
}
