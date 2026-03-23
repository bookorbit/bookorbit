import { IsArray, IsInt, IsPositive } from 'class-validator';

export class SetLibrariesDto {
  @IsArray()
  @IsInt({ each: true })
  @IsPositive({ each: true })
  libraryIds: number[];
}
