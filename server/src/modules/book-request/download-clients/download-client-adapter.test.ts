import { categoryForMedium, ownedCategories } from './download-client-adapter';

describe('categoryForMedium', () => {
  const overridden = { category: 'bookorbit', audiobookCategory: 'bookorbit-audio', comicCategory: 'bookorbit-comics' };

  it('files each medium under its own override', () => {
    expect(categoryForMedium(overridden, 'ebook')).toBe('bookorbit');
    expect(categoryForMedium(overridden, 'audiobook')).toBe('bookorbit-audio');
    expect(categoryForMedium(overridden, 'comic')).toBe('bookorbit-comics');
  });

  it('falls back to the default category when a medium has no override', () => {
    const plain = { category: 'bookorbit', audiobookCategory: null, comicCategory: null };
    expect(categoryForMedium(plain, 'audiobook')).toBe('bookorbit');
    expect(categoryForMedium(plain, 'comic')).toBe('bookorbit');
  });

  it('treats a blank override as no override', () => {
    expect(categoryForMedium({ category: 'bookorbit', audiobookCategory: '  ', comicCategory: '' }, 'audiobook')).toBe('bookorbit');
    expect(categoryForMedium({ category: 'bookorbit', audiobookCategory: '  ', comicCategory: '' }, 'comic')).toBe('bookorbit');
  });
});

describe('ownedCategories', () => {
  it('lists the default first, then each distinct override', () => {
    expect(ownedCategories({ category: 'bookorbit', audiobookCategory: 'audio', comicCategory: 'comics' })).toEqual(['bookorbit', 'audio', 'comics']);
  });

  it('drops blank and repeated categories so nothing is listed twice or claims unlabelled downloads', () => {
    expect(ownedCategories({ category: 'bookorbit', audiobookCategory: 'bookorbit', comicCategory: ' ' })).toEqual(['bookorbit']);
    expect(ownedCategories({ category: '  ', audiobookCategory: null, comicCategory: null })).toEqual([]);
  });
});
