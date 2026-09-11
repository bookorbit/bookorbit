export interface AudiobookChapter {
  title: string;
  startMs: number;
}

export const AUDIOBOOK_MANIFEST_SCHEMA = "bookorbit.audiobook-manifest" as const;
export const AUDIOBOOK_MANIFEST_VERSION = 2 as const;

export interface AudiobookManifestAsset {
  assetId: string;
  sequence: number;
  format: string;
  durationMs: number | null;
  sizeBytes: number | null;
  etag: string;
}

export interface AudiobookManifestChapter {
  id: string;
  title: string;
  assetId: string;
  sequence: number;
  startMs: number;
  endMs: number;
  assetOffsetMs: number;
}

export interface AudiobookManifest {
  schema: typeof AUDIOBOOK_MANIFEST_SCHEMA;
  schemaVersion: typeof AUDIOBOOK_MANIFEST_VERSION;
  revision: string;
  book: {
    id: number;
    title: string;
    authors: string[];
    narrators: string[];
    hasCover: boolean;
  };
  assets: AudiobookManifestAsset[];
  chapters: AudiobookManifestChapter[];
  totalDurationMs: number;
}

export interface AudiobookPlaybackState {
  assetId: string;
  positionMs: number;
  percentage: number;
  completed: boolean;
  capturedAt: string;
  revision: number;
  manifestRevision: string;
}

export interface PutAudiobookPlaybackState {
  assetId: string;
  positionMs: number;
  capturedAt: string;
  operationId: string;
  baseRevision: number;
  manifestRevision: string;
}

export interface AudiobookBookmark {
  id: string;
  bookId: number;
  positionMs: number;
  chapterId: string | null;
  title: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAudiobookBookmark {
  clientId: string;
  positionMs: number;
  chapterId?: string;
  title: string;
  note?: string;
}

export interface UpdateAudiobookBookmark {
  title?: string;
  note?: string | null;
}

export interface NarratorRef {
  id: number;
  name: string;
  sortName: string | null;
  displayOrder: number;
}
