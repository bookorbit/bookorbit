import { ArrayUnique, IsArray, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateDefaultLibraryAccessDto {
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  libraryIds: number[] = [];
}
