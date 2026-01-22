import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SortSpecDto } from './create-lens.dto';

export class UpdateLensDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  filter?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SortSpecDto)
  defaultSort?: SortSpecDto[];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
