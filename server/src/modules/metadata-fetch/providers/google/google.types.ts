export interface GoogleBooksResponse {
  items?: GoogleVolumeItem[];
  totalItems?: number;
}

export interface GoogleVolumeItem {
  id: string;
  volumeInfo: GoogleVolumeInfo;
}

export interface GoogleVolumeInfo {
  title: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  publisher?: string;
  publishedDate?: string;
  pageCount?: number;
  averageRating?: number;
  ratingsCount?: number;
  language?: string;
  categories?: string[];
  industryIdentifiers?: GoogleIndustryIdentifier[];
  imageLinks?: {
    thumbnail?: string;
    smallThumbnail?: string;
  };
}

export interface GoogleIndustryIdentifier {
  type: 'ISBN_10' | 'ISBN_13' | 'OTHER';
  identifier: string;
}
