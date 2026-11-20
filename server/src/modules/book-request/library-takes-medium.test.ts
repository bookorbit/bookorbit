import { libraryTakesMedium } from './library-takes-medium';

describe('libraryTakesMedium', () => {
  it('lets every medium into a library with no format list', () => {
    expect(libraryTakesMedium([], 'ebook')).toBe(true);
    expect(libraryTakesMedium([], 'audiobook')).toBe(true);
  });

  it('keeps ebooks out of a library limited to audio formats, and lets audiobooks in', () => {
    const audioOnly = ['m4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac'];

    expect(libraryTakesMedium(audioOnly, 'ebook')).toBe(false);
    expect(libraryTakesMedium(audioOnly, 'audiobook')).toBe(true);
  });

  it('counts a comic format as the ebook medium, the way requests do', () => {
    expect(libraryTakesMedium(['cbz'], 'ebook')).toBe(true);
  });

  it('reads the list the way the Library Dock does, ignoring case, padding and blanks', () => {
    expect(libraryTakesMedium([' EPUB '], 'ebook')).toBe(true);
    expect(libraryTakesMedium(['', '  '], 'audiobook')).toBe(true);
  });

  it('takes no retired medium into a library with a format list', () => {
    expect(libraryTakesMedium(['cbz'], 'comic')).toBe(false);
  });
});
