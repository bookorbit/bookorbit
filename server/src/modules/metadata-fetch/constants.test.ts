import { METADATA_PROVIDERS } from './constants';

describe('metadata-fetch constants', () => {
  it('uses a symbol token for provider multibinding to avoid string token collisions', () => {
    expect(typeof METADATA_PROVIDERS).toBe('symbol');
    expect(METADATA_PROVIDERS.description).toBe('METADATA_PROVIDERS');
    expect(METADATA_PROVIDERS).not.toBe(Symbol.for('METADATA_PROVIDERS'));
  });
});
