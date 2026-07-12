export interface LibroFmSearchAudiobook {
  title?: string | null;
  isbn?: string | number | null;
  authors?: string[] | null;
  cover_url?: string | null;
  audiobook_info?: {
    narrators?: string[] | null;
  } | null;
}

export interface LibroFmSearchResponse {
  audiobook_collection?: {
    audiobooks?: LibroFmSearchAudiobook[] | null;
  } | null;
}

export interface LibroFmAudiobook {
  title?: string | null;
  subtitle?: string | null;
  isbn?: string | number | null;
  description?: string | null;
  abridged?: boolean | null;
  series?: string | null;
  series_num?: string | number | null;
  genres?: Array<{ name?: string | null }> | null;
  audiobook_info?: {
    narrators?: string[] | null;
    duration?: number | null;
    audio_language?: string | null;
    audio_language_display?: string | null;
  } | null;
  authors?: string[] | null;
  cover_url?: string | null;
  publisher?: string | null;
  publication_date?: string | null;
}

export interface LibroFmDetailsResponse {
  data?: {
    audiobook?: LibroFmAudiobook | null;
  } | null;
}
