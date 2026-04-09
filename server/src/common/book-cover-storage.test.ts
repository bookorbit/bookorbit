import { join } from 'path';

import {
  bookCoverDirPath,
  bookThumbnailPath,
  findExtractedBookCoverFileName,
  findPreferredBookCoverFileName,
  isCustomBookCoverFileName,
  isExtractedBookCoverFileName,
} from './book-cover-storage';

describe('book-cover-storage', () => {
  it('builds cover and thumbnail paths under the book cover directory', () => {
    expect(bookCoverDirPath('/books', 42)).toBe(join('/books', 'covers', '42'));
    expect(bookThumbnailPath('/books', 42)).toBe(join('/books', 'covers', '42', 'thumbnail.jpg'));
  });

  it('detects custom and extracted cover file names', () => {
    expect(isCustomBookCoverFileName('cover_custom.png')).toBe(true);
    expect(isCustomBookCoverFileName('cover_extracted.png')).toBe(false);
    expect(isExtractedBookCoverFileName('cover_extracted.jpg')).toBe(true);
    expect(isExtractedBookCoverFileName('cover_custom.jpg')).toBe(false);
  });

  it('prefers custom covers over extracted covers', () => {
    expect(findPreferredBookCoverFileName(['thumbnail.jpg', 'cover_extracted.jpg', 'cover_custom.png'])).toBe('cover_custom.png');
    expect(findPreferredBookCoverFileName(['thumbnail.jpg', 'cover_extracted.jpg'])).toBe('cover_extracted.jpg');
    expect(findPreferredBookCoverFileName(['thumbnail.jpg'])).toBeNull();
  });

  it('finds extracted cover files when present', () => {
    expect(findExtractedBookCoverFileName(['cover_custom.png', 'cover_extracted.jpg'])).toBe('cover_extracted.jpg');
    expect(findExtractedBookCoverFileName(['cover_custom.png'])).toBeNull();
  });
});
