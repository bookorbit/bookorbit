import { ArrayMinSize, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PrescanLibraryDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(4096, { each: true })
  paths: string[];
}
