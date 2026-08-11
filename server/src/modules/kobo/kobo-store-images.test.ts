import { buildKoboStoreImageUrl } from './kobo-store-images';

describe('buildKoboStoreImageUrl', () => {
  it('builds the quality template Kobo advertises as image_url_quality_template', () => {
    expect(buildKoboStoreImageUrl('cover-id', ['355', '530', '80', 'False'])).toBe(
      'https://cdn.kobo.com/book-images/cover-id/355/530/80/False/image.jpg',
    );
  });

  it('builds the plain template Kobo advertises as image_url_template', () => {
    expect(buildKoboStoreImageUrl('cover-id', ['355', '530', 'false'])).toBe('https://cdn.kobo.com/book-images/cover-id/355/530/false/image.jpg');
  });

  it('rejects empty and blank segments', () => {
    expect(buildKoboStoreImageUrl('', ['355', '530', 'false'])).toBeNull();
    expect(buildKoboStoreImageUrl('cover-id', ['355', '   ', 'false'])).toBeNull();
  });

  it('keeps traversal and host injection attempts inside the CDN path', () => {
    expect(buildKoboStoreImageUrl('../../etc/passwd', ['355', '530', 'false'])).toBe(
      'https://cdn.kobo.com/book-images/..%2F..%2Fetc%2Fpasswd/355/530/false/image.jpg',
    );
    expect(buildKoboStoreImageUrl('evil.example.com', ['355', '530', 'false'])).toBe(
      'https://cdn.kobo.com/book-images/evil.example.com/355/530/false/image.jpg',
    );
    expect(new URL(buildKoboStoreImageUrl('//evil.example.com', ['355', '530', 'false'])!).hostname).toBe('cdn.kobo.com');
  });
});
