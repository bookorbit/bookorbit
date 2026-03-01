import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';

export class BulkBookIdsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  bookIds: number[];
}
