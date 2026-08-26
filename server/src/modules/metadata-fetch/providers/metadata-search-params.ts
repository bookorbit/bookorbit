import { MetadataProviderKey } from '@bookorbit/types';

export interface MetadataSearchParams {
  title?: string;
  author?: string;
  isbn?: string;
  // Series context for providers that address records by series plus position rather than by title
  // (e.g. ComicVine volume plus issue number). A comic title holds only the issue name, so the
  // pairing cannot be recovered from it.
  seriesName?: string;
  seriesIndex?: string;
  // True when `title` is a query the caller typed rather than the book's own stored title. Stored
  // series context may then fill in what the query omits, but must not override what it states.
  titleIsExplicitQuery?: boolean;
  existingProviderIds?: Partial<Record<MetadataProviderKey, string>>;
  // Pins a Hardcover refresh to a previously chosen edition instead of re-deriving one by ISBN.
  hardcoverEditionId?: string;
  // Media type of the edition being searched. Providers that carry both editions of a title use it to
  // pick one (e.g. the iTunes ebook vs audiobook entity), so it must describe the book, not the provider set.
  isAudiobook?: boolean;
  // Lets audiobook-only providers run for a book that is not an audiobook, for the flows where they were
  // explicitly asked for. Defaults to isAudiobook.
  includeAudiobookProviders?: boolean;
  // Hint for providers to cap deep candidate exploration in non-interactive flows
  // (e.g. auto-fill/background refresh where there is no manual candidate picking).
  maxCandidatesPerProvider?: number;
  // Interactive result lists can afford bounded cover checks. Bulk metadata pipelines must not
  // multiply one provider lookup into many thumbnail requests.
  validateCoverPlaceholders?: boolean;
  // Internal-only signal used by orchestration timeout/cancellation.
  signal?: AbortSignal;
}
