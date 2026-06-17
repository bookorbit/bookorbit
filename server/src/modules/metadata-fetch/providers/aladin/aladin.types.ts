export interface AladinItem {
  title: string;
  link: string;
  author: string;
  pubDate: string;
  description: string;
  isbn: string;
  isbn13: string;
  priceSales: number;
  priceStandard: number;
  mallType: string;
  stockStatus: string;
  mileage: number;
  cover: string;
  publisher: string;
  salesPoint: number;
  adult: boolean;
  customerReviewRank: number;
  bestRank?: number;
  fullDescription?: string;
  fullDescription2?: string;
  categoryIdList?: Array<{ categoryId: number; categoryName: string }>;
  seriesInfo?: { seriesId: number; seriesName: string; seriesLink: string };
  subInfo?: {
    itemPage: number;
    toc?: string;
    itemWeight?: number;
    itemVolume?: string;
    editionName?: string;
    itemOrigin?: string;
    translateAuthor?: string;
    itemBindingType?: string;
    packgeGb?: string;
    giftYn?: string;
    ebookList?: unknown[];
    usedList?: unknown[];
    reviewList?: unknown[];
    authors?: Array<{ name: string; link: string }>;
    phraseList?: string[];
    tocList?: string[];
  };
}

export interface AladinSearchResponse {
  version: number;
  title: string;
  link: string;
  pubDate: string;
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  query: string;
  searchCategoryId: number;
  searchCategoryName: string;
  item: AladinItem[];
}

export interface AladinLookupResponse {
  version: number;
  title: string;
  link: string;
  pubDate: string;
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  query: string;
  searchCategoryId: number;
  searchCategoryName: string;
  item: AladinItem[];
}
