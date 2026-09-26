import { join } from 'path';

import {
  bookCoverDirPath,
  bookCoverSlotDirPath,
  bookCoverSlotThumbnailPath,
  findPreferredBookCoverFileName,
  isCustomBookCoverFileName,
  isExtractedBookCoverFileName,
} from './book-cover-storage';

describe('book-cover-storage', () => {
  it('builds slot cover and thumbnail paths under the book cover directory', () => {
    expect(bookCoverDirPath('/books', 42)).toBe(join('/books', 'covers', '42'));
    expect(bookCoverSlotDirPath('/books', 42, 'audio')).toBe(join('/books', 'covers', '42', 'audio'));
    expect(bookCoverSlotThumbnailPath('/books', 42, 'ebook')).toBe(join('/books', 'covers', '42', 'ebook', 'thumbnail.jpg'));
  });

  it('detects custom and extracted cover file names', () => {
    expect(isCustomBookCoverFileName('cover_custom.png')).toBe(true);
    expect(isCustomBookCoverFileName('cover_extracted.png')).toBe(false);
    expect(isExtractedBookCoverFileName('cover_extracted.jpg')).toBe(true);
    expect(isExtractedBookCoverFileName('cover_custom.jpg')).toBe(false);
  });

  it('prefers custom and extracted covers over legacy cover files', () => {
    expect(findPreferredBookCoverFileName(['thumbnail.jpg', 'cover_extracted.jpg', 'cover_custom.png'])).toBe('cover_custom.png');
    expect(findPreferredBookCoverFileName(['thumbnail.jpg', 'cover_extracted.jpg'])).toBe('cover_extracted.jpg');
    expect(findPreferredBookCoverFileName(['thumbnail.jpg', 'cover.jpg'])).toBe('cover.jpg');
    expect(findPreferredBookCoverFileName(['thumbnail.jpg', 'cover.png'])).toBe('cover.png');
    expect(findPreferredBookCoverFileName(['thumbnail.jpg'])).toBeNull();
  });
});
