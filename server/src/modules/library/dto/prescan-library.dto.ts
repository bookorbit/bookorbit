import { ArrayMinSize, IsArray, IsNotEmpty, IsString } from 'class-validator';

export class PrescanLibraryDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  paths: string[];
}
