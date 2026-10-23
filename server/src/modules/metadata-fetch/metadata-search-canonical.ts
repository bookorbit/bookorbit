import type { MetadataProviderKey } from '@bookorbit/types';

import { canonicalId, canonicalIsbn, canonicalText } from '../../common/provider-cache/canonicalize';
import { MetadataSearchParams } from './providers/metadata-search-params';

/**
 * The canonical form providers receive and cache keys are built from. Equal requests then always
 * share an answer, and a shared answer always came from an identical request.
 */
export function canonicalizeSearchParams(params: MetadataSearchParams): MetadataSearchParams {
  const canonical: MetadataSearchParams = {
    ...params,
    title: canonicalText(params.title),
    author: canonicalText(params.author),
    isbn: canonicalIsbn(params.isbn),
    seriesName: canonicalText(params.seriesName),
    seriesIndex: canonicalText(params.seriesIndex),
    hardcoverEditionId: canonicalId(params.hardcoverEditionId),
  };
  // Presence of the map, even empty, marks a refresh of an established book, so it is kept as-is.
  if (params.existingProviderIds) {
    const ids: Partial<Record<MetadataProviderKey, string>> = {};
    for (const [provider, id] of Object.entries(params.existingProviderIds)) {
      const value = canonicalId(id);
      if (value) ids[provider as MetadataProviderKey] = value;
    }
    canonical.existingProviderIds = ids;
  }
  return canonical;
}
