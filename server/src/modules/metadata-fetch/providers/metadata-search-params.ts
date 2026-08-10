import { MetadataProviderKey } from '@bookorbit/types';

export interface MetadataSearchParams {
  title?: string;
  author?: string;
  isbn?: string;
  // Series context for providers that address records by series plus position rather than by title
  // (e.g. ComicVine volume plus issue number). A comic title holds only the issue name, so the
  // pairing cannot be recovered from it.
  seriesName?: string;
  seriesIndex?: number;
  existingProviderIds?: Partial<Record<MetadataProviderKey, string>>;
  // Pins a Hardcover refresh to a previously chosen edition instead of re-deriving one by ISBN.
  hardcoverEditionId?: string;
  isAudiobook?: boolean;
  // Hint for providers to cap deep candidate exploration in non-interactive flows
  // (e.g. auto-fill/background refresh where there is no manual candidate picking).
  maxCandidatesPerProvider?: number;
  // Internal-only signal used by orchestration timeout/cancellation.
  signal?: AbortSignal;
}
