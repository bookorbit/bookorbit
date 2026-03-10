import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, Min } from 'class-validator';

export class MergeAuthorsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetAuthorId: number;

  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  sourceAuthorIds: number[];
}
