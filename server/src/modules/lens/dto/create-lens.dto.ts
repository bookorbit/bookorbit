import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SortSpecDto {
  @IsString()
  field: string;

  @IsString()
  dir: 'asc' | 'desc';
}

export class CreateLensDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  filter?: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SortSpecDto)
  defaultSort: SortSpecDto[];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
