import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  BOOK_REQUEST_LIST_VIEWS,
  BOOK_REQUEST_MEDIA_KINDS,
  BOOK_REQUEST_SEARCH_MAX_LENGTH,
  BOOK_REQUEST_SORT_DIRECTIONS,
  BOOK_REQUEST_SORT_FIELDS,
  BOOK_REQUEST_STATUSES,
} from '@bookorbit/types';
import type { BookRequestListView, BookRequestMediaKind, BookRequestSortDirection, BookRequestSortField, BookRequestStatus } from '@bookorbit/types';

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

  /**
   * One entry per ebook and audiobook pair, led by the ebook half with the audiobook embedded as
   * its companion, rather than one entry per request. Opt-in, because a client that keys its rows
   * by request id needs every request as an entry of its own.
   */
  @IsOptional()
  @Transform(({ value }) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : value))
  @IsBoolean()
  groupPairs?: boolean;

  /**
   * A title or author fragment. Blank is the same as absent, so a cleared search box asks for the
   * whole list rather than for the rows that match nothing.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(BOOK_REQUEST_SEARCH_MAX_LENGTH)
  q?: string;

  /**
   * One section of the page. When present it decides which hidden rows are included, so
   * `includeDismissed` is ignored alongside it.
   */
  @IsOptional()
  @IsIn(BOOK_REQUEST_LIST_VIEWS)
  view?: BookRequestListView;
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
