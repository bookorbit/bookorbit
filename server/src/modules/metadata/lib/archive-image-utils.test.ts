import { compareArchiveEntryNames, isArchiveImageFile, isHiddenArchivePath } from './archive-image-utils';

describe('archive-image-utils', () => {
  it('detects supported image file extensions case-insensitively', () => {
    expect(isArchiveImageFile('cover.JPG')).toBe(true);
    expect(isArchiveImageFile('folder/page.png')).toBe(true);
  });

  it('returns false for non-image or extensionless entries', () => {
    expect(isArchiveImageFile('metadata.txt')).toBe(false);
    expect(isArchiveImageFile('cover')).toBe(false);
  });

  it('detects hidden paths in nested archive entries', () => {
    expect(isHiddenArchivePath('.hidden.jpg')).toBe(true);
    expect(isHiddenArchivePath('folder/.hidden/page.jpg')).toBe(true);
    expect(isHiddenArchivePath('folder/page.jpg')).toBe(false);
  });

  it('sorts archive entries by natural filename order', () => {
    const entries = ['page10.jpg', 'Page1.JPG', 'page2.jpg'];
    expect(entries.toSorted(compareArchiveEntryNames)).toEqual(['Page1.JPG', 'page2.jpg', 'page10.jpg']);
  });

  it('sorts a complete base filename before a filename that extends its stem', () => {
    const entries = ['IMG_0004_Seite_001_1L.jpg', 'IMG.jpg'];
    expect(entries.toSorted(compareArchiveEntryNames)).toEqual(['IMG.jpg', 'IMG_0004_Seite_001_1L.jpg']);
  });
});
