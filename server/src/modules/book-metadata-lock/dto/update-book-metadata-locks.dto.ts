import type { BookMetadataLockField } from '@bookorbit/types';
import { BOOK_METADATA_LOCK_FIELDS } from '@bookorbit/types';
import { ArrayUnique, IsArray, IsIn } from 'class-validator';

export class UpdateBookMetadataLocksDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(BOOK_METADATA_LOCK_FIELDS, { each: true })
  lockedFields!: BookMetadataLockField[];
}
