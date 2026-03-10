import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, Min } from 'class-validator';

export class DeleteAuthorsDto {
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  authorIds: number[];
}
