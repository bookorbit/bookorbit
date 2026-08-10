import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';

import type { BookMoveCollisionPolicy, BookMoveJobCollisionPolicy } from '@bookorbit/types';
import { BOOK_MOVE_COLLISION_POLICIES, BOOK_MOVE_JOB_COLLISION_POLICIES } from '@bookorbit/types';

import { BulkSelectionDto } from '../../../common/dto/bulk-selection.dto';

export class MovePreviewDto {
  @ValidateNested()
  @Type(() => BulkSelectionDto)
  selection!: BulkSelectionDto;

  @IsInt()
  @Min(1)
  targetLibraryId!: number;

  @IsInt()
  @Min(1)
  targetFolderId!: number;
}

export class MoveCollisionOverrideDto {
  @IsInt()
  @Min(1)
  bookId!: number;

  @IsIn(BOOK_MOVE_COLLISION_POLICIES)
  policy!: BookMoveCollisionPolicy;
}

export class MoveBooksDto extends MovePreviewDto {
  @IsIn(BOOK_MOVE_JOB_COLLISION_POLICIES)
  collisionPolicy!: BookMoveJobCollisionPolicy;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => MoveCollisionOverrideDto)
  overrides?: MoveCollisionOverrideDto[];
}
