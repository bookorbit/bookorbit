import { MetadataProviderKey } from '@bookorbit/types';

export interface MetadataSearchParams {
  title?: string;
  author?: string;
  isbn?: string;
  existingProviderIds?: Partial<Record<MetadataProviderKey, string>>;
  isAudiobook?: boolean;
  // Hint for providers to cap deep candidate exploration in non-interactive flows
  // (e.g. auto-fill/background refresh where there is no manual candidate picking).
  maxCandidatesPerProvider?: number;
  // Internal-only signal used by orchestration timeout/cancellation.
  signal?: AbortSignal;
}
