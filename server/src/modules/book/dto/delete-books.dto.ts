import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';

export class DeleteBooksDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  bookIds: number[];
}
