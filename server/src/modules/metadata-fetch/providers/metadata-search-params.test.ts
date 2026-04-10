import { MetadataProviderKey } from '@projectx/types';

import type { MetadataSearchParams } from './metadata-search-params';

describe('MetadataSearchParams', () => {
  it('supports partial provider id hints and orchestration-only fields together', () => {
    const signal = new AbortController().signal;
    const params: MetadataSearchParams = {
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '9780441013593',
      isAudiobook: false,
      maxCandidatesPerProvider: 5,
      signal,
      existingProviderIds: {
        [MetadataProviderKey.GOOGLE]: 'google-123',
        [MetadataProviderKey.OPEN_LIBRARY]: 'OL82563W',
      },
    };

    expect(params.existingProviderIds?.[MetadataProviderKey.GOOGLE]).toBe('google-123');
    expect(params.existingProviderIds?.[MetadataProviderKey.OPEN_LIBRARY]).toBe('OL82563W');
    expect(params.maxCandidatesPerProvider).toBe(5);
    expect(params.signal).toBe(signal);
  });
});
