import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, Length, MaxLength, ValidateNested } from 'class-validator';

import {
  SHELF_MATCH_MAX_ID_LENGTH,
  SHELF_MATCH_MAX_LINE_LENGTH,
  SHELF_MATCH_MAX_LINES,
  SHELF_MATCH_MAX_SPINES,
  type ShelfMatchRequest,
  type ShelfSpine,
} from '@bookorbit/types';

export class ShelfSpineDto implements ShelfSpine {
  @IsString()
  @Length(1, SHELF_MATCH_MAX_ID_LENGTH)
  id!: string;

  @IsArray()
  @ArrayMaxSize(SHELF_MATCH_MAX_LINES)
  @IsString({ each: true })
  @MaxLength(SHELF_MATCH_MAX_LINE_LENGTH, { each: true })
  lines!: string[];
}

export class ShelfMatchDto implements ShelfMatchRequest {
  @IsArray()
  @ArrayMaxSize(SHELF_MATCH_MAX_SPINES)
  @ValidateNested({ each: true })
  @Type(() => ShelfSpineDto)
  spines!: ShelfSpineDto[];
}
