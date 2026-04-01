import { isArchiveImageFile, isHiddenArchivePath } from './archive-image-utils';

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
});
