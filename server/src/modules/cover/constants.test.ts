import { COVER_PROVIDERS } from './constants';

describe('cover constants', () => {
  it('uses a symbol token for provider multibinding', () => {
    expect(typeof COVER_PROVIDERS).toBe('symbol');
  });
});
