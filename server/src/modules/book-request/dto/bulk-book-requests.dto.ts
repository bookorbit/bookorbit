import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { BOOK_REQUEST_BULK_LIMIT } from '@bookorbit/types';
import type { BulkBookRequestsPayload, BulkRejectBookRequestsPayload } from '@bookorbit/types';

/**
 * Deliberately ids only. Bulk approval takes each request's own destination; rerouting a library
 * is a judgement about one book, and applying one reroute to a whole selection is not something
 * the approver can have meant.
 */
export class BulkBookRequestsDto implements BulkBookRequestsPayload {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BOOK_REQUEST_BULK_LIMIT)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids!: number[];
}

/**
 * Rejection is the exception to the rule above: the note is about why the answer is no, which is
 * the same answer for every request in the selection, so one sentence covers all of them.
 */
export class BulkRejectBookRequestsDto extends BulkBookRequestsDto implements BulkRejectBookRequestsPayload {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  decisionNote?: string;
}
