import { IsInt, IsOptional, IsPositive, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QuerySendLogDto {
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
}
