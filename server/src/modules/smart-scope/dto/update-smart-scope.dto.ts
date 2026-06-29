import { Transform, Type } from 'class-transformer';
import { ICON_VALUE_MAX_LENGTH, type GroupRule } from '@bookorbit/types';
import { IsArray, IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { SortSpecDto } from './create-smart-scope.dto';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateSmartScopeDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(ICON_VALUE_MAX_LENGTH)
  icon?: string;

  @IsOptional()
  @IsObject()
  filter?: GroupRule | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SortSpecDto)
  defaultSort?: SortSpecDto[];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
