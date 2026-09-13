import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BOOK_REQUEST_MEDIA_KINDS, BOOK_REQUEST_SORT_DIRECTIONS, BOOK_REQUEST_SORT_FIELDS, BOOK_REQUEST_STATUSES } from '@bookorbit/types';
import type { BookRequestMediaKind, BookRequestSortDirection, BookRequestSortField, BookRequestStatus } from '@bookorbit/types';

export class ListBookRequestsDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsIn(BOOK_REQUEST_STATUSES)
  status?: BookRequestStatus;

  @IsOptional()
  @IsIn(BOOK_REQUEST_MEDIA_KINDS)
  mediaKind?: BookRequestMediaKind;

  /** Rows the caller has hidden are left out unless they ask for them back. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeDismissed?: boolean;

  /**
   * Narrows to self-served rows, or to the ones that went through approval. Server-side because a
   * badge on the twenty rows already fetched filters a page rather than the queue: an approver
   * asking "what is actually waiting on me" would still page through everything else.
   */
  @IsOptional()
  @Transform(({ value }) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : value))
  @IsBoolean()
  selfServe?: boolean;

  /**
   * Ordering is a query concern, not a client one: sorting the twenty rows already fetched would
   * reorder a page rather than the list, and page 2 would disagree with page 1.
   */
  @IsOptional()
  @IsIn(BOOK_REQUEST_SORT_FIELDS)
  sortBy?: BookRequestSortField;

  @IsOptional()
  @IsIn(BOOK_REQUEST_SORT_DIRECTIONS)
  sortDir?: BookRequestSortDirection;
}

/**
 * The approver queue's list, which is the only one that may ask about somebody else's requests.
 *
 * Split from the base rather than shared with it: the requester filter used to be accepted on the
 * personal list and silently ignored there, so a caller narrowing "my requests" to another person
 * was answered with their own rows and no hint that the filter had not applied. Declared only on
 * the admin list, `forbidNonWhitelisted` refuses it on the personal one instead.
 */
export class ListAllBookRequestsDto extends ListBookRequestsDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  requesterUserId?: number;
}
