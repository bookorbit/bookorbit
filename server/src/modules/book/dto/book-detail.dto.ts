import type {
  AudiobookChapter,
  AudiobookChapterSource,
  BookFileWriteStatus,
  BookSeriesMembership,
  BookMetadataLockField,
  BookCommunityRating,
  CustomMetadataBookValue,
  ComicMetadataFields,
  BookCoverSlot,
  CoverAspectRatio,
  CoverMedium,
  NarratorRef,
  ProviderIds,
  ReadAloudProgressSync,
  UserBookStatus,
  EpubMediaOverlayCapability,
} from '@bookorbit/types';

export class BookFileDto {
  fileHash?: string | null;
  contentVersion?: string;
  id: number;
  format: string | null;
  role: string;
  sizeBytes: number | null;
  absolutePath: string;
  createdAt: Date;
  filename: string | null;
  durationSeconds: number | null;
  mediaOverlay: EpubMediaOverlayCapability | null;
}

export class AudioMetadataDto {
  narrators: NarratorRef[];
  durationSeconds: number | null;
  abridged: boolean;
  chapters: AudiobookChapter[] | null;
  chaptersSource: AudiobookChapterSource | null;
  chaptersUpdatedAt: string | null;
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
  publishedDate: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  seriesId: number | null;
  seriesName: string | null;
  seriesIndex: string | null;
  seriesMemberships: BookSeriesMembership[];
  rating: number | null;
  personalNote: string | null;
  personalNoteUpdatedAt: Date | null;
  communityRatings: BookCommunityRating[];
  coverSource: 'extracted' | 'custom' | null;
  coverMedia: CoverMedium[];
  covers: Record<CoverMedium, BookCoverSlot | null>;
  /** The frame of the cover the book shows by default: square when that is its audiobook art. */
  coverAspectRatio: CoverAspectRatio;
  coverVersion: string;
  hardcoverEditionId: string | null;
  providerIds: ProviderIds;
  /** Record links for external providers' ids. See `BookDetail.providerLinks`. */
  providerLinks?: Partial<Record<string, string>>;
  authors: { id: number; name: string; sortName: string | null }[];
  genres: string[];
  tags: string[];
  files: BookFileDto[];
  lastWrittenAt: Date | null;
  metadataScore: number | null;
  readStatus: UserBookStatus | null;
  audioMetadata: AudioMetadataDto | null;
  readAloudSync: ReadAloudProgressSync;
  formatPriority: string[];
  comicMetadata: ComicMetadataFields | null;
  customMetadata: CustomMetadataBookValue[];
  lockedFields: BookMetadataLockField[];
  collections: { id: number; name: string }[];
  fileWriteStatus: BookFileWriteStatus;
}
