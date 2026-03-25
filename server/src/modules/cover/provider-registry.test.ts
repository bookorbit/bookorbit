import { BadRequestException } from '@nestjs/common';

import { CoverProvider } from './providers/cover-provider';
import { CoverProviderRegistry } from './provider-registry';

function makeProvider(key: CoverProvider['key']): CoverProvider {
  return {
    key,
    search: vi.fn().mockResolvedValue([]),
  };
}

describe('CoverProviderRegistry', () => {
  const duckduckgo = makeProvider('duckduckgo');
  const itunes = makeProvider('itunes');
  const registry = new CoverProviderRegistry([duckduckgo, itunes]);

  it('defaults to duckduckgo when provider is omitted', () => {
    expect(registry.select()).toEqual([duckduckgo]);
  });

  it('returns all providers when provider is all', () => {
    expect(registry.select('all')).toEqual([duckduckgo, itunes]);
  });

  it('returns the requested provider', () => {
    expect(registry.select('itunes')).toEqual([itunes]);
  });

  it('throws for unknown provider keys', () => {
    expect(() => registry.select('unknown')).toThrow(BadRequestException);
  });
});
