import { AuthorMetadataProviderError, isIdentifiableAuthorProvider } from './author-metadata-provider';

describe('author metadata provider helpers', () => {
  it('detects identifiable providers via discriminant field', () => {
    const identifiable = {
      key: 'audnexus',
      label: 'Audnexus',
      identifiable: true,
      search: vi.fn(),
      lookupById: vi.fn(),
    };
    const nonIdentifiable = {
      key: 'custom',
      label: 'Custom',
      identifiable: false,
      search: vi.fn(),
    };

    expect(isIdentifiableAuthorProvider(identifiable as never)).toBe(true);
    expect(isIdentifiableAuthorProvider(nonIdentifiable as never)).toBe(false);
  });

  it('stores provider error metadata with sane defaults', () => {
    const withOptions = new AuthorMetadataProviderError('rate limited', {
      httpStatus: 429,
      retryAfterMs: 5000,
      transient: true,
    });
    const withDefaults = new AuthorMetadataProviderError('unexpected response');

    expect(withOptions.name).toBe('AuthorMetadataProviderError');
    expect(withOptions.httpStatus).toBe(429);
    expect(withOptions.retryAfterMs).toBe(5000);
    expect(withOptions.transient).toBe(true);

    expect(withDefaults.httpStatus).toBeNull();
    expect(withDefaults.retryAfterMs).toBeNull();
    expect(withDefaults.transient).toBe(false);
  });
});
