import { BadRequestException } from '@nestjs/common';

import { CoverProvider, DUCKDUCKGO_PROVIDER_KEY, ITUNES_PROVIDER_KEY } from './providers/cover-provider';
import { CoverProviderRegistry } from './provider-registry';

function makeProvider(key: CoverProvider['key']): CoverProvider {
  return {
    key,
    search: vi.fn().mockResolvedValue([]),
  };
}

describe('CoverProviderRegistry', () => {
  const duckduckgo = makeProvider(DUCKDUCKGO_PROVIDER_KEY);
  const itunes = makeProvider(ITUNES_PROVIDER_KEY);
  const registry = new CoverProviderRegistry([duckduckgo, itunes]);

  it('defaults to duckduckgo when provider is omitted', () => {
    expect(registry.select()).toEqual([duckduckgo]);
  });

  it('returns all providers when provider is all', () => {
    expect(registry.select('all')).toEqual([duckduckgo, itunes]);
  });

  it('returns the requested provider', () => {
    expect(registry.select(ITUNES_PROVIDER_KEY)).toEqual([itunes]);
  });

  it('trims provider values before selecting', () => {
    expect(registry.select(` ${ITUNES_PROVIDER_KEY} `)).toEqual([itunes]);
  });

  it('throws for unknown provider keys', () => {
    expect(() => registry.select('unknown')).toThrow(BadRequestException);
  });
});
