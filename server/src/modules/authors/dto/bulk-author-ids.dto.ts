import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Min } from 'class-validator';

export class BulkAuthorIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  authorIds!: number[];
}
