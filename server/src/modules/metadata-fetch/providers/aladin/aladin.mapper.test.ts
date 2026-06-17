import { MetadataProviderKey } from '@bookorbit/types';
import { mapAladinItem } from './aladin.mapper';
import { AladinItem } from './aladin.types';

describe('AladinMapper', () => {
  const baseItem: AladinItem = {
    title: '테스트 도서',
    link: 'https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=12345',
    author: '테스트 저자',
    pubDate: '2024-01-15',
    description: '테스트 설명',
    isbn: '8912345678',
    isbn13: '9788912345678',
    priceSales: 15000,
    priceStandard: 18000,
    mallType: 'BOOK',
    stockStatus: '',
    mileage: 450,
    cover: 'https://image.aladin.co.kr/product/12345/cover.jpg',
    publisher: '테스트 출판사',
    salesPoint: 100,
    adult: false,
    customerReviewRank: 8,
  };

  it('should map basic fields correctly', () => {
    const result = mapAladinItem(baseItem);

    expect(result.provider).toBe(MetadataProviderKey.ALADIN);
    expect(result.providerId).toBe('12345');
    expect(result.title).toBe('테스트 도서');
    expect(result.authors).toEqual(['테스트 저자']);
    expect(result.publisher).toBe('테스트 출판사');
    expect(result.publishedYear).toBe(2024);
    expect(result.isbn10).toBe('8912345678');
    expect(result.isbn13).toBe('9788912345678');
    expect(result.language).toBe('ko');
    expect(result.coverUrl).toBe('https://image.aladin.co.kr/product/12345/cover.jpg');
    expect(result.sourceUrl).toBe('https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=12345');
  });

  it('should handle multiple authors', () => {
    const item = { ...baseItem, author: '저자1, 저자2, 저자3' };
    const result = mapAladinItem(item);
    expect(result.authors).toEqual(['저자1', '저자2', '저자3']);
  });

  it('should handle missing author', () => {
    const item = { ...baseItem, author: '' };
    const result = mapAladinItem(item);
    expect(result.authors).toBeUndefined();
  });

  it('should parse page count from subInfo', () => {
    const item = { ...baseItem, subInfo: { itemPage: 350 } };
    const result = mapAladinItem(item);
    expect(result.pageCount).toBe(350);
  });

  it('should handle missing subInfo', () => {
    const item = { ...baseItem };
    delete (item as Partial<AladinItem>).subInfo;
    const result = mapAladinItem(item);
    expect(result.pageCount).toBeUndefined();
  });

  it('should use fullDescription when available', () => {
    const item = { ...baseItem, fullDescription: '전체 설명입니다.' };
    const result = mapAladinItem(item);
    expect(result.description).toBe('전체 설명입니다.');
  });

  it('should strip HTML tags from description', () => {
    const item = { ...baseItem, description: '<p>HTML <b>설명</b></p>' };
    const result = mapAladinItem(item);
    expect(result.description).toBe('HTML 설명');
  });

  it('should parse genres from categoryIdList', () => {
    const item = {
      ...baseItem,
      categoryIdList: [
        { categoryId: 100, categoryName: '소설/시/희곡' },
        { categoryId: 200, categoryName: '인문학' },
      ],
    };
    const result = mapAladinItem(item);
    expect(result.genres).toEqual(['소설/시/희곡', '인문학']);
  });

  it('should handle missing categoryIdList', () => {
    const item = { ...baseItem };
    delete (item as Partial<AladinItem>).categoryIdList;
    const result = mapAladinItem(item);
    expect(result.genres).toBeUndefined();
  });

  it('should parse series name without fabricating an index', () => {
    const item = { ...baseItem, seriesInfo: { seriesId: 1, seriesName: '테스트 시리즈', seriesLink: 'https://aladin.co.kr/series/1' } };
    const result = mapAladinItem(item);
    expect(result.seriesName).toBe('테스트 시리즈');
    expect(result.seriesIndex).toBeUndefined();
  });

  it('should handle missing series info', () => {
    const item = { ...baseItem };
    delete (item as Partial<AladinItem>).seriesInfo;
    const result = mapAladinItem(item);
    expect(result.seriesName).toBeUndefined();
    expect(result.seriesIndex).toBeUndefined();
  });

  it('should use the Aladin ItemId from the link for providerId', () => {
    const result = mapAladinItem(baseItem);
    expect(result.providerId).toBe('12345');
  });

  it('should leave providerId empty when the link has no ItemId (ISBNs still mapped to their own fields)', () => {
    const item = { ...baseItem, link: 'https://www.aladin.co.kr/shop/wproduct.aspx' };
    const result = mapAladinItem(item);
    expect(result.providerId).toBe('');
    expect(result.isbn10).toBe('8912345678');
    expect(result.isbn13).toBe('9788912345678');
  });
});
