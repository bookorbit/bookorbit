import { createHash } from 'crypto';

import { MetadataProviderKey, type MetadataCandidate } from '@bookorbit/types';

import { GoogleCoverValidator } from './google-cover-validator';

function candidate(coverUrl: string): MetadataCandidate {
  return { provider: MetadataProviderKey.GOOGLE, providerId: coverUrl, title: 'Book', coverUrl };
}

function response(status: number, headers: Record<string, string> = {}, body: Uint8Array | null = null): Response {
  return new Response(body, { status, headers });
}

describe('GoogleCoverValidator', () => {
  it('removes the known HTTP 200 placeholder while preserving the candidate', async () => {
    const placeholder = Buffer.from('google-books-placeholder-fixture');
    const hash = createHash('sha256').update(placeholder).digest('hex');
    const fetchImage = vi
      .fn()
      .mockResolvedValueOnce(response(200, { 'content-type': 'image/png', 'content-length': String(placeholder.length) }))
      .mockResolvedValueOnce(response(200, { 'content-type': 'image/png' }, placeholder));
    const validator = new GoogleCoverValidator({
      fetchImage,
      placeholderLengths: new Set([placeholder.length]),
      placeholderHashes: new Set([hash]),
    });

    const [result] = await validator.filterCandidates([candidate('https://books.google.com/books/content?id=missing')]);

    expect(result).toEqual(expect.objectContaining({ providerId: 'https://books.google.com/books/content?id=missing', coverUrl: undefined }));
    expect(fetchImage).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({ method: 'HEAD', redirect: 'manual' }));
    expect(fetchImage).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ redirect: 'manual' }));
  });

  it('keeps a valid cover without downloading its body when headers cannot match the placeholder', async () => {
    const fetchImage = vi.fn().mockResolvedValue(response(200, { 'content-type': 'image/jpeg', 'content-length': '120000' }));
    const validator = new GoogleCoverValidator({ fetchImage });
    const coverUrl = 'https://books.google.com/books/content?id=real';

    const [result] = await validator.filterCandidates([candidate(coverUrl)]);

    expect(result?.coverUrl).toBe(coverUrl);
    expect(fetchImage).toHaveBeenCalledOnce();
  });

  it('keeps a cover when validation is unavailable instead of dropping potentially valid artwork', async () => {
    const fetchImage = vi.fn().mockRejectedValue(new Error('network unavailable'));
    const validator = new GoogleCoverValidator({ fetchImage });
    const coverUrl = 'https://books.google.com/books/content?id=unknown';

    const [result] = await validator.filterCandidates([candidate(coverUrl)]);

    expect(result?.coverUrl).toBe(coverUrl);
  });

  it('does not fetch provider-supplied URLs outside the fixed Google Books cover endpoint', async () => {
    const fetchImage = vi.fn();
    const validator = new GoogleCoverValidator({ fetchImage });
    const coverUrl = 'https://example.test/cover.jpg';

    const [result] = await validator.filterCandidates([candidate(coverUrl)]);

    expect(result?.coverUrl).toBe(coverUrl);
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('bounds concurrent validation work', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchImage = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return response(200, { 'content-type': 'image/jpeg', 'content-length': '120000' });
    });
    const validator = new GoogleCoverValidator({ fetchImage });
    const candidates = Array.from({ length: 12 }, (_, index) => candidate(`https://books.google.com/books/content?id=${index}`));

    await validator.filterCandidates(candidates);

    expect(maxActive).toBeLessThanOrEqual(5);
  });
});
