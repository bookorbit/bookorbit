import {
  normalizeCoverAspectRatio,
  type AnnotationPositionStatus,
  type NotebookBookLabel,
  type NotebookBookmarkItem,
  type NotebookHighlightEntry,
  type NotebookJournalItem,
  type NotebookReviewItem,
} from '@bookorbit/types';

import type { AnnotationRow, BookJournalEntryRow, BookmarkRow } from '../../db/schema';

export type NotebookHighlightRow = Pick<
  AnnotationRow,
  | 'id'
  | 'bookId'
  | 'text'
  | 'color'
  | 'style'
  | 'note'
  | 'chapterTitle'
  | 'origin'
  | 'sourceCreatedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'starredAt'
> & { cfi: string | null; cfiStatus: string | null };

export type NotebookJournalRow = Pick<
  BookJournalEntryRow,
  | 'id'
  | 'clientId'
  | 'bookId'
  | 'body'
  | 'quote'
  | 'chapterTitle'
  | 'positionPercent'
  | 'cfi'
  | 'positionSeconds'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
>;

export type NotebookBookmarkRow = Pick<
  BookmarkRow,
  'id' | 'clientId' | 'bookId' | 'title' | 'note' | 'cfi' | 'positionSeconds' | 'origin' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

export interface NotebookReviewRow {
  bookId: number;
  note: string | null;
  updatedAt: Date;
  rating: number | null;
}

export interface NotebookLabelRow {
  id: number;
  title: string | null;
  author: string | null;
  coverSource: string | null;
  coverAspectRatio: string;
  updatedAt: Date;
  readFileId: number | null;
  readFileFormat: string | null;
  hasAudio: boolean;
}

/** Trash items carry `deletedAt`; every other listing leaves the field out. */
export interface NotebookMapOptions {
  withDeletedAt?: boolean;
}

function deletedAtField(deletedAt: Date | null, options: NotebookMapOptions): { deletedAt?: string | null } {
  return options.withDeletedAt ? { deletedAt: deletedAt ? deletedAt.toISOString() : null } : {};
}

/** Mirrors the annotation hub's item: the write time a device reported wins, and a CFI row without a status reads as exact. */
export function toNotebookHighlight(row: NotebookHighlightRow, options: NotebookMapOptions = {}): NotebookHighlightEntry {
  return {
    kind: 'highlight',
    id: row.id,
    bookId: row.bookId,
    clientId: null,
    createdAt: (row.sourceCreatedAt ?? row.createdAt).toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...deletedAtField(row.deletedAt, options),
    text: row.text,
    color: row.color,
    style: row.style,
    note: row.note ?? null,
    chapterTitle: row.chapterTitle ?? null,
    cfi: row.cfi ?? null,
    positionStatus: (row.cfi != null || row.cfiStatus != null ? (row.cfiStatus ?? 'exact') : null) as AnnotationPositionStatus | null,
    origin: row.origin,
    starredAt: row.starredAt ? row.starredAt.toISOString() : null,
  };
}

export function toNotebookJournal(row: NotebookJournalRow, options: NotebookMapOptions = {}): NotebookJournalItem {
  return {
    kind: 'journal',
    id: row.id,
    bookId: row.bookId,
    clientId: row.clientId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...deletedAtField(row.deletedAt, options),
    body: row.body,
    quote: row.quote ?? null,
    chapterTitle: row.chapterTitle ?? null,
    positionPercent: row.positionPercent ?? null,
    cfi: row.cfi ?? null,
    positionSeconds: row.positionSeconds ?? null,
  };
}

export function toNotebookBookmark(row: NotebookBookmarkRow): NotebookBookmarkItem {
  return {
    kind: 'bookmark',
    id: row.id,
    bookId: row.bookId,
    clientId: row.clientId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    title: row.title,
    note: row.note ?? null,
    cfi: row.cfi ?? null,
    positionSeconds: row.positionSeconds ?? null,
    origin: row.origin,
  };
}

/** The server keeps only a review's latest edit time, so it is both when it was written and when it changed. */
export function toNotebookReview(row: NotebookReviewRow): NotebookReviewItem {
  const at = row.updatedAt.toISOString();
  return {
    kind: 'review',
    id: row.bookId,
    bookId: row.bookId,
    clientId: null,
    createdAt: at,
    updatedAt: at,
    body: row.note ?? '',
    rating: row.rating ?? null,
  };
}

/** `coverVersion` is computed by the cover store, exactly as it is for a library book card. */
export function toNotebookBookLabel(row: NotebookLabelRow, coverVersion: string): NotebookBookLabel {
  return {
    id: row.id,
    title: row.title ?? null,
    author: row.author ?? null,
    hasCover: row.coverSource != null,
    coverVersion,
    coverAspectRatio: normalizeCoverAspectRatio(row.coverAspectRatio),
    readFileId: row.readFileId ?? null,
    readFileFormat: row.readFileFormat ? row.readFileFormat.toLowerCase() : null,
    hasAudio: row.hasAudio === true,
  };
}
