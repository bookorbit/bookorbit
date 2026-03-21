export interface AudNexusBook {
  asin: string;
  name: string;
  authors?: Array<{ name: string; asin: string }>;
  narrators?: Array<{ name: string }>;
  image?: string;
  language?: string;
  runtimeLengthMin?: number;
  formatType?: string;
  seriesName?: string;
  seriesPart?: string;
  publisherName?: string;
  releaseDate?: string;
  summary?: string;
}

export interface AudNexusChapter {
  title: string;
  startOffsetMs: number;
  startOffsetSec: number;
  lengthMs: number;
}

export interface AudNexusChaptersResponse {
  asin: string;
  brandIntroDurationMs?: number;
  brandOutroDurationMs?: number;
  chapters?: AudNexusChapter[];
  runtimeLengthMs?: number;
  runtimeLengthSec?: number;
}

export interface AudNexusSearchResult {
  asin: string;
  name: string;
  authors?: Array<{ name: string; asin: string }>;
}
