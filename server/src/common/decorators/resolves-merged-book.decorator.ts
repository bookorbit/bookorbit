import { SetMetadata } from '@nestjs/common';

export const RESOLVES_MERGED_BOOK_KEY = 'resolvesMergedBook';

export interface ResolvesMergedBookOptions {
  /** Route params that hold a book id. */
  params?: string[];
  /** Top-level body fields that hold a book id or an array of book ids. */
  body?: string[];
}

/**
 * Rewrites a merged-away book id in the named params and body fields to the book it was merged
 * into, before pipes run. Only for routes a released client may still send with an old id; see
 * `MergedBookAliasInterceptor`.
 */
export const ResolvesMergedBook = (options: ResolvesMergedBookOptions) => SetMetadata(RESOLVES_MERGED_BOOK_KEY, options);
