import type { AudiobookChapter, AudiobookChapterSource, ComicMetadataFields, NarratorRef, UserBookStatus } from '@bookorbit/types';
import type { BookDetailDto } from '../dto/book-detail.dto';

type NarratorRow = {
  id: number;
  name: string;
  sortName: string | null;
};

type AudioMetaSource = {
  durationSeconds: number | null | undefined;
  abridged: boolean | null | undefined;
  chaptersSource?: AudiobookChapterSource | null;
  chaptersUpdatedAt?: Date | null;
};

type ComicMetaSource = {
  issueNumber?: string | null;
  volumeName?: string | null;
  pencillers?: string[] | null;
  inkers?: string[] | null;
  colorists?: string[] | null;
  letterers?: string[] | null;
  coverArtists?: string[] | null;
  characters?: string[] | null;
  teams?: string[] | null;
  locations?: string[] | null;
  storyArcs?: string[] | null;
} | null;

type CollectionRow = {
  id: number;
  name: string;
};

type SupplementalFieldInput = {
  readStatus: UserBookStatus | null;
  hasAudioFiles: boolean;
  narratorRows: NarratorRow[];
  audioMeta: AudioMetaSource;
  chapters: AudiobookChapter[] | null;
  comicMeta: ComicMetaSource;
  collections: CollectionRow[];
};

function buildAudioMetadata(
  hasAudioFiles: boolean,
  narratorRows: NarratorRow[],
  audioMeta: AudioMetaSource,
  chapters: AudiobookChapter[] | null,
): BookDetailDto['audioMetadata'] {
  if (!hasAudioFiles && narratorRows.length === 0) return null;

  const narrators = narratorRows.map<NarratorRef>((narrator, index) => ({
    id: narrator.id,
    name: narrator.name,
    sortName: narrator.sortName,
    displayOrder: index,
  }));

  // Narrators outlive the audio (a read-along EPUB, or a merged entry whose audio was removed).
  // Stored duration and chapters describe audio files the book no longer has.
  if (!hasAudioFiles) {
    return { narrators, durationSeconds: null, abridged: false, chapters: null, chaptersSource: null, chaptersUpdatedAt: null };
  }

  return {
    narrators,
    durationSeconds: audioMeta.durationSeconds ?? null,
    abridged: audioMeta.abridged ?? false,
    chapters,
    chaptersSource: audioMeta.chaptersSource ?? null,
    chaptersUpdatedAt: audioMeta.chaptersUpdatedAt?.toISOString() ?? null,
  };
}

function buildComicMetadata(comicMeta: ComicMetaSource): ComicMetadataFields | null {
  if (!comicMeta) return null;

  return {
    issueNumber: comicMeta.issueNumber ?? undefined,
    volumeName: comicMeta.volumeName ?? undefined,
    pencillers: comicMeta.pencillers ?? undefined,
    inkers: comicMeta.inkers ?? undefined,
    colorists: comicMeta.colorists ?? undefined,
    letterers: comicMeta.letterers ?? undefined,
    coverArtists: comicMeta.coverArtists ?? undefined,
    characters: comicMeta.characters ?? undefined,
    teams: comicMeta.teams ?? undefined,
    locations: comicMeta.locations ?? undefined,
    storyArcs: comicMeta.storyArcs ?? undefined,
  };
}

export function buildBookDetailSupplementalFields({
  readStatus,
  hasAudioFiles,
  narratorRows,
  audioMeta,
  chapters,
  comicMeta,
  collections,
}: SupplementalFieldInput): Pick<BookDetailDto, 'readStatus' | 'audioMetadata' | 'comicMetadata' | 'collections'> {
  return {
    readStatus: readStatus ?? null,
    audioMetadata: buildAudioMetadata(hasAudioFiles, narratorRows, audioMeta, chapters),
    comicMetadata: buildComicMetadata(comicMeta),
    collections,
  };
}
