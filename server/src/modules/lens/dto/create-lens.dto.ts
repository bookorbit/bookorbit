import { Type } from 'class-transformer';
import type { GroupRule, SortField, SortSpec } from '@projectx/types';
import { SORT_FIELDS } from '@projectx/types';
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

const SORT_DIRECTIONS: ReadonlyArray<SortSpec['dir']> = ['asc', 'desc'];

export class SortSpecDto {
  @IsIn(SORT_FIELDS)
  field: SortField;

  @IsIn(SORT_DIRECTIONS)
  dir: SortSpec['dir'];
}

export class CreateLensDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  icon?: string;

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
