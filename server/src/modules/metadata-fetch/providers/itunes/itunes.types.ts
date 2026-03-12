export interface ITunesResult {
  trackId: number;
  trackName: string;
  artistName: string;
  description?: string;
  releaseDate?: string;
  genres?: string[];
  artworkUrl100?: string;
  kind: 'ebook' | 'audiobook';
  trackViewUrl?: string;
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
