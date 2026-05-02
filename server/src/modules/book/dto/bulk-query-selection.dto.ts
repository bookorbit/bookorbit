import { IsArray, IsInt, IsObject, IsOptional, IsString } from 'class-validator';
import type { GroupRule } from '@bookorbit/types';
import type { SortSpec } from '@bookorbit/types';

export class BulkQuerySelectionDto {
  @IsOptional()
  @IsInt()
  libraryId?: number;

  @IsOptional()
  @IsObject()
  filter?: GroupRule;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  sort?: SortSpec[];
}
