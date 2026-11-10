import { apiKeyHint, generateApiKeyToken, hasValidApiKeyChecksum, hashApiKeyToken, isApiKeyShaped } from './api-key-token';

describe('API key tokens', () => {
  it('generates prefixed tokens of a fixed length with a valid checksum', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateApiKeyToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^bok_[0-9A-Za-z]{49}$/);
      expect(isApiKeyShaped(token)).toBe(true);
      expect(hasValidApiKeyChecksum(token)).toBe(true);
    }
  });

  it('rejects a typo, a truncation and garbage before any lookup', () => {
    const token = generateApiKeyToken();
    const flipped = token.slice(0, 10) + (token[10] === 'a' ? 'b' : 'a') + token.slice(11);
    expect(hasValidApiKeyChecksum(flipped)).toBe(false);
    expect(hasValidApiKeyChecksum(token.slice(0, -1))).toBe(false);
    expect(hasValidApiKeyChecksum(`${token}x`)).toBe(false);
    expect(hasValidApiKeyChecksum('bok_' + '!'.repeat(49))).toBe(false);
    expect(hasValidApiKeyChecksum('eyJhbGciOiJIUzI1NiJ9.e30.sig')).toBe(false);
  });

  it('hashes to stable hex and keeps only the last characters as a hint', () => {
    const token = generateApiKeyToken();
    expect(hashApiKeyToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKeyToken(token)).toBe(hashApiKeyToken(token));
    expect(apiKeyHint(token)).toBe(token.slice(-4));
  });

  it('tells a key apart from a session token by its prefix', () => {
    expect(isApiKeyShaped('eyJhbGciOiJIUzI1NiJ9.e30.sig')).toBe(false);
    expect(isApiKeyShaped('bok_anything')).toBe(true);
  });
});
