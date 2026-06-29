import { Test, TestingModule } from '@nestjs/testing';
import { ProviderConfigurations } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { AladinProvider } from './aladin.provider';

describe('AladinProvider', () => {
  let provider: AladinProvider;
  let providerConfig: ProviderConfigService;

  const mockConfig: ProviderConfigurations = {
    google: { enabled: true, apiKey: 'test-api-key' },
    amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
    goodreads: { enabled: true },
    hardcover: { enabled: false, apiKey: '' },
    openLibrary: { enabled: true },
    itunes: { enabled: true, coverResolution: 'high' },
    audible: { enabled: false, domain: 'com' },
    audnexus: { enabled: false },
    comicvine: { enabled: false, apiKey: '' },
    ranobedb: { enabled: false },
    aladin: { enabled: true, ttbKey: 'test-ttb-key' },
  };

  const mockAladinItem = {
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
    fullDescription: '전체 설명',
    categoryIdList: [{ categoryId: 100, categoryName: '소설/시/희곡' }],
    seriesInfo: { seriesId: 1, seriesName: '테스트 시리즈', seriesLink: 'https://aladin.co.kr/series/1' },
    subInfo: { itemPage: 300, toc: '목차', authors: [{ name: '테스트 저자', link: 'https://aladin.co.kr/author/1' }] },
  };

  const mockAladinSearchResponse = {
    version: 20131101,
    title: '알라딘 검색 결과',
    link: 'https://www.aladin.co.kr',
    pubDate: '2024-01-15T00:00:00',
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 10,
    query: '테스트',
    searchCategoryId: 0,
    searchCategoryName: '',
    item: [mockAladinItem],
  };

  const mockAladinLookupResponse = {
    version: 20131101,
    title: '알라딘 상품 조회',
    link: 'https://www.aladin.co.kr',
    pubDate: '2024-01-15T00:00:00',
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 1,
    query: '9788912345678',
    searchCategoryId: 0,
    searchCategoryName: '',
    item: [mockAladinItem],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AladinProvider,
        {
          provide: ProviderConfigService,
          useValue: {
            getConfig: vi.fn().mockResolvedValue(mockConfig),
          },
        },
      ],
    }).compile();

    provider = module.get<AladinProvider>(AladinProvider);
    providerConfig = module.get<ProviderConfigService>(ProviderConfigService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('search', () => {
    it('should return empty array if disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        aladin: { enabled: false, ttbKey: '' },
      });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });

    it('should return empty array if TTB key is missing', async () => {
      global.fetch = vi.fn();
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        aladin: { enabled: true, ttbKey: '' },
      });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should fetch from Aladin and return mapped items', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockAladinSearchResponse),
      });

      const result = await provider.search({ title: '테스트 도서' });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://www.aladin.co.kr/ttb/api/ItemSearch.aspx'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('TTBKey=test-ttb-key'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('Query=%ED%85%8C%EC%8A%A4%ED%8A%B8+%EB%8F%84%EC%84%9C'), expect.any(Object));
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('테스트 도서');
      expect(result[0].providerId).toBe('12345');
      expect(result[0].provider).toBe('aladin');
      expect(result[0].authors).toEqual(['테스트 저자']);
      expect(result[0].publisher).toBe('테스트 출판사');
      expect(result[0].publishedYear).toBe(2024);
      expect(result[0].isbn13).toBe('9788912345678');
      expect(result[0].language).toBe('ko');
      expect(result[0].genres).toEqual(['소설/시/희곡']);
    });

    it('should search by ISBN using ItemLookUp with ISBN13 for 13-digit ISBNs', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockAladinLookupResponse),
      });

      const result = await provider.search({ isbn: '9788912345678' });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('ItemLookUp.aspx'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('ItemId=9788912345678'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('ItemIdType=ISBN13'), expect.any(Object));
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('테스트 도서');
    });

    it('should search by ISBN using ItemLookUp with ISBN for 10-digit ISBNs', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockAladinLookupResponse),
      });

      await provider.search({ isbn: '8912345678' });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('ItemLookUp.aspx'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('ItemId=8912345678'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('ItemIdType=ISBN'), expect.any(Object));
    });

    it('should fall back to keyword search for invalid ISBN format', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ item: [] }),
      });

      await provider.search({ isbn: 'not-an-isbn' });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('ItemSearch.aspx'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('Query=not-an-isbn'), expect.any(Object));
    });

    it('should return empty array on fetch error', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });

    it('should return empty array if no results', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });
  });

  describe('lookupById', () => {
    it('should return null if TTB key is missing', async () => {
      global.fetch = vi.fn();
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        aladin: { enabled: true, ttbKey: '' },
      });

      const result = await provider.lookupById('9788912345678');
      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should look up by Aladin ItemId and return the mapped item', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockAladinLookupResponse),
      });

      const result = await provider.lookupById('12345');

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('ItemIdType=ItemId'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('ItemId=12345'), expect.any(Object));
      expect(result).not.toBeNull();
      expect(result?.title).toBe('테스트 도서');
      expect(result?.providerId).toBe('12345');
    });

    it('should pass the providerId through unchanged as the ItemId', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockAladinLookupResponse),
      });

      const result = await provider.lookupById('9788912345678');

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('ItemIdType=ItemId'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('ItemId=9788912345678'), expect.any(Object));
      expect(result).not.toBeNull();
    });

    it('should return null on fetch error', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

      const result = await provider.lookupById('9788912345678');
      expect(result).toBeNull();
    });

    it('should return null if item not found', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ item: [] }),
      });

      const result = await provider.lookupById('9788912345678');
      expect(result).toBeNull();
    });
  });
});
