import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class PrescanLibraryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  libraryId?: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(4096, { each: true })
  paths: string[];
}
