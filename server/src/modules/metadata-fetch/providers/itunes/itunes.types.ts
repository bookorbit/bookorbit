export interface ITunesResult {
  trackId?: number;
  collectionId?: number;
  trackName?: string;
  collectionName?: string;
  artistName?: string;
  description?: string;
  releaseDate?: string;
  genres?: string[];
  artworkUrl100?: string;
  kind: 'ebook' | 'audiobook';
  trackViewUrl?: string;
  collectionViewUrl?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  // Additional fields from documentation
  fileSizeBytes?: number;
  languageCodesISO2A?: string[];
  sellerName?: string;
}

export interface ITunesResponse {
  resultCount: number;
  results: ITunesResult[];
}
