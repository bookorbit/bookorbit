import type { EmailSendLogQuery } from '@bookorbit/types';
import { IsIn, IsInt, IsOptional, IsPositive, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QuerySendLogDto implements EmailSendLogQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(100)
  size?: number = 20;

  /**
   * Narrows the log to one book. Without it, a client that has just queued a send has to fetch the
   * newest page and match on bookId itself, which stops working as soon as two books are sent in
   * quick succession. The iOS client uses this to resolve a send from "queued" to delivered or
   * failed; no web client route reaches it.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  bookId?: number;

  /** Narrows the log to one outcome. Only the web client sends it; older servers reject it. */
  @IsOptional()
  @IsIn(['pending', 'sent', 'failed'])
  status?: 'pending' | 'sent' | 'failed';

  /**
   * Narrows the log to one of the caller's recipients, including rows logged before recipient ids
   * were stored, which are matched by address. Only the web client sends it; older servers reject it.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  recipientId?: number;
}
