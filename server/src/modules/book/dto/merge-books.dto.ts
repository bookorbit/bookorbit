import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class MergeBooksDto {
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  sourceBookIds!: number[];

  @Type(() => Number)
  @IsInt()
  targetBookId!: number;
}
