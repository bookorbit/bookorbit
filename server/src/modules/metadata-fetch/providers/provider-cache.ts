import { canonicalJson } from '../../../common/provider-cache/canonicalize';
import type { ProviderCacheContext } from '../../../common/provider-cache/provider-cache-spec';
import { MetadataSearchParams } from './metadata-search-params';
import { allowsAudiobookProviders, searchPageSize } from './provider-utils';

/**
 * Shared pieces of each provider's cache declaration. Keep key inputs conservative: every value the
 * provider reads must be here, because a missing one lets one request's answer serve another.
 */

export function providerCacheContext(available: boolean, fingerprint: Record<string, unknown> = {}): ProviderCacheContext {
  return { available, fingerprint: canonicalJson(fingerprint) };
}

type SearchField =
  'title' | 'author' | 'isbn' | 'seriesName' | 'seriesIndex' | 'titleIsExplicitQuery' | 'hardcoverEditionId' | 'requireUnambiguousMatch';

export function pickSearchInputs(params: MetadataSearchParams, fields: readonly SearchField[]): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const field of fields) inputs[field] = params[field];
  return inputs;
}

/** Audiobook-only providers answer nothing unless asked for audiobooks, so the gate is part of the key. */
export function audiobookGate(params: MetadataSearchParams): boolean {
  return allowsAudiobookProviders(params);
}

/**
 * A widened page holds records the default one does not, so its size is part of the key. The default
 * size stays out of it, which keeps every answer stored before pages could widen addressable.
 */
export function widenedPageSize(params: MetadataSearchParams, defaultSize: number): number | undefined {
  const size = searchPageSize(params, defaultSize);
  return size === defaultSize ? undefined : size;
}

/** Absent means the provider's own default (its largest), matching how providers read the cap. */
export function requestedMax(params: MetadataSearchParams): number | null {
  const value = params.maxCandidatesPerProvider;
  if (value === undefined || !Number.isFinite(value)) return null;
  return Math.max(1, Math.floor(value));
}
