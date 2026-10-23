import { MetadataProviderKey, type MetadataCandidate } from '@bookorbit/types';

import { bookLookupCodec, bookSearchCodec } from './metadata-cache-codecs';

const candidate: MetadataCandidate = {
  provider: MetadataProviderKey.GOOGLE,
  providerId: 'g1',
  title: 'Dune',
  publishedDate: '1965-08-01',
  chapters: [{ title: 'One', startSeconds: 0, durationSeconds: 10 }] as MetadataCandidate['chapters'],
};

describe('book cache codecs', () => {
  it('stores only known candidate fields', () => {
    const withExtra = { ...candidate, internalToken: 'secret' } as MetadataCandidate;

    expect(bookSearchCodec.sanitize([withExtra])).toEqual([candidate]);
    expect(bookLookupCodec.sanitize(withExtra)).toEqual(candidate);
  });

  it('round-trips a stored answer, including a lookup that found nothing', () => {
    const stored = JSON.parse(JSON.stringify(bookSearchCodec.sanitize([candidate]))) as unknown;

    expect(bookSearchCodec.parse(stored)).toEqual([candidate]);
    expect(bookLookupCodec.parse(null)).toBeNull();
  });

  it('reports an unreadable payload as undefined rather than as an empty answer', () => {
    expect(bookSearchCodec.parse({})).toBeUndefined();
    expect(bookSearchCodec.parse([{ provider: 'google' }])).toBeUndefined();
    expect(bookLookupCodec.parse({ providerId: 1 })).toBeUndefined();
  });

  it('rejects a candidate whose fields have the wrong type, so it is never replayed', () => {
    const wrong = (patch: Record<string, unknown>) => [{ ...candidate, ...patch }];

    expect(bookSearchCodec.parse(wrong({ authors: 'Frank Herbert' }))).toBeUndefined();
    expect(bookSearchCodec.parse(wrong({ authors: ['Frank Herbert', 7] }))).toBeUndefined();
    expect(bookSearchCodec.parse(wrong({ publishedDate: 1965 }))).toBeUndefined();
    expect(bookSearchCodec.parse(wrong({ pageCount: '412' }))).toBeUndefined();
    expect(bookSearchCodec.parse(wrong({ abridged: 'no' }))).toBeUndefined();
    expect(bookSearchCodec.parse(wrong({ comicMetadata: 'issue 1' }))).toBeUndefined();
    expect(bookSearchCodec.parse(wrong({ chapters: ['One'] }))).toBeUndefined();
  });

  it('reads a null field as absent', () => {
    expect(bookSearchCodec.parse([{ ...candidate, subtitle: null }])).toEqual([candidate]);
  });

  it('slices results and exposes publication dates', () => {
    const second = { ...candidate, providerId: 'g2', publishedDate: undefined, publishedYear: 2026 };

    expect(bookSearchCodec.slice([candidate, second], 1)).toEqual([candidate]);
    expect(bookSearchCodec.publishedDates([candidate, second])).toEqual(['1965-08-01', '2026']);
  });
});
