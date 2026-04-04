import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

class UserMappingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  sourceUserId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetUserId!: number;
}

class PathMappingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  sourcePrefix!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  targetPrefix!: string;
}

export class CreateMigrationProfileDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserMappingDto)
  userMappings!: UserMappingDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PathMappingDto)
  pathMappings?: PathMappingDto[];

  @IsOptional()
  @IsObject()
  scope?: Record<string, unknown>;
}
