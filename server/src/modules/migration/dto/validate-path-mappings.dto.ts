import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

class PathMappingInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  sourcePrefix!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  targetPrefix!: string;
}

export class ValidatePathMappingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PathMappingInputDto)
  pathMappings!: PathMappingInputDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  sampleLimit?: number;
}
