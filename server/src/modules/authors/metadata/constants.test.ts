import { AUTHOR_METADATA_PROVIDERS } from './constants';

describe('AUTHOR_METADATA_PROVIDERS', () => {
  it('is a stable symbol token for provider injection', () => {
    expect(typeof AUTHOR_METADATA_PROVIDERS).toBe('symbol');
    expect(AUTHOR_METADATA_PROVIDERS.description).toBe('AUTHOR_METADATA_PROVIDERS');
  });
});
