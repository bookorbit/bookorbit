export interface AudNexusBook {
  asin: string;
  // Historical field (older AudNexus payloads)
  name?: string;
  // Current field
  title?: string;
  subtitle?: string;
  authors?: Array<{ name: string; asin: string }>;
  narrators?: Array<{ name: string }>;
  image?: string;
  language?: string;
  runtimeLengthMin?: number;
  formatType?: string;
  description?: string;
  seriesPrimary?: {
    asin?: string;
    name?: string;
    position?: string | number;
  };
  // Historical fields (older AudNexus payloads)
  seriesName?: string;
  seriesPart?: string | number;
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
