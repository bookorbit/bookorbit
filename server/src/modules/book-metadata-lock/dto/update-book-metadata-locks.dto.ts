import type { BookMetadataLockField } from '@projectx/types';
import { BOOK_METADATA_LOCK_FIELDS } from '@projectx/types';
import { ArrayUnique, IsArray, IsIn } from 'class-validator';

export class UpdateBookMetadataLocksDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(BOOK_METADATA_LOCK_FIELDS, { each: true })
  lockedFields!: BookMetadataLockField[];
}
