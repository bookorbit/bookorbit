import { Transform, Type } from 'class-transformer';
import type { GroupRule, SortField, SortSpec } from '@bookorbit/types';
import { ICON_VALUE_MAX_LENGTH, SORT_FIELDS } from '@bookorbit/types';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

const SORT_DIRECTIONS: ReadonlyArray<SortSpec['dir']> = ['asc', 'desc'];

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class SortSpecDto {
  @IsIn(SORT_FIELDS)
  field: SortField;

  @IsIn(SORT_DIRECTIONS)
  dir: SortSpec['dir'];
}

export class CreateSmartScopeDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(ICON_VALUE_MAX_LENGTH)
  icon: string;

  @IsOptional()
  @IsObject()
  filter?: GroupRule | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SortSpecDto)
  defaultSort: SortSpecDto[];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
