import { ArrayMinSize, IsArray, IsInt } from 'class-validator';

export class CollectionBooksDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  bookIds: number[];
}
