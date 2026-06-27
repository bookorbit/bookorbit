import type {
  AudiobookChapter,
  BookFileWriteStatus,
  BookSeriesMembership,
  BookMetadataLockField,
  BookCommunityRating,
  CustomMetadataBookValue,
  ComicMetadataFields,
  NarratorRef,
  ProviderIds,
  UserBookStatus,
} from '@bookorbit/types';

export class BookFileDto {
  id: number;
  format: string | null;
  role: string;
  sizeBytes: number | null;
  absolutePath: string;
  createdAt: Date;
  filename: string | null;
  durationSeconds: number | null;
}

export class AudioMetadataDto {
  narrators: NarratorRef[];
  durationSeconds: number | null;
  abridged: boolean;
  chapters: AudiobookChapter[] | null;
}

export class BookDetailDto {
  id: number;
  libraryId: number;
  libraryName: string;
  status: string;
  folderPath: string;
  addedAt: Date;
  updatedAt: Date | null;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  seriesId: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  seriesMemberships: BookSeriesMembership[];
  rating: number | null;
  communityRatings: BookCommunityRating[];
  coverSource: 'extracted' | 'custom' | null;
  hardcoverEditionId: string | null;
  providerIds: ProviderIds;
  authors: { id: number; name: string; sortName: string | null }[];
  genres: string[];
  tags: string[];
  files: BookFileDto[];
  lastWrittenAt: Date | null;
  metadataScore: number | null;
  readStatus: UserBookStatus | null;
  audioMetadata: AudioMetadataDto | null;
  formatPriority: string[];
  comicMetadata: ComicMetadataFields | null;
  customMetadata: CustomMetadataBookValue[];
  lockedFields: BookMetadataLockField[];
  collections: { id: number; name: string }[];
  fileWriteStatus: BookFileWriteStatus;
}
