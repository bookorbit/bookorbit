import { resolveIsAudiobook } from './book-media.utils';

describe('resolveIsAudiobook', () => {
  it('uses the primary file when the book has files', () => {
    expect(resolveIsAudiobook([{ format: 'm4b', role: 'primary' }], null)).toBe(true);
    expect(resolveIsAudiobook([{ format: 'epub', role: 'primary' }], null)).toBe(false);
  });

  it('follows the primary file for a book that holds both editions', () => {
    const files = [
      { format: 'epub', role: 'primary' },
      { format: 'm4b', role: 'content' },
    ];

    expect(resolveIsAudiobook(files, null)).toBe(false);
  });

  it('leads with the file the library ranked first, not the one that sorts first by path', () => {
    const files = [
      { id: 1, format: 'epub', role: 'content' },
      { id: 2, format: 'm4b', role: 'content' },
    ];
    expect(resolveIsAudiobook(files, null, 2)).toBe(true);
    expect(resolveIsAudiobook(files, null, 1)).toBe(false);
    expect(resolveIsAudiobook(files, null, null)).toBe(false);
  });

  it('ignores stale audiobook identifiers on an ebook', () => {
    expect(resolveIsAudiobook([{ format: 'epub', role: 'primary' }], { audibleId: 'B0ABC12345', durationSeconds: 3600 })).toBe(false);
  });

  it('falls back to audio metadata when no file states a format', () => {
    expect(resolveIsAudiobook([{ format: null, role: 'content' }], { durationSeconds: 3600 })).toBe(true);
    expect(resolveIsAudiobook([], { librofmId: '9781234567890' })).toBe(true);
    expect(resolveIsAudiobook(undefined, { audibleId: 'B0ABC12345' })).toBe(true);
    expect(resolveIsAudiobook(undefined, null)).toBe(false);
  });
});
