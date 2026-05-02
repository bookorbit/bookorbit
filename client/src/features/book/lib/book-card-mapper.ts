import type { BookCard, BookDetail, BookFileRef } from '@bookorbit/types'
import type { ColumnId } from '@/features/book/composables/useTableColumns'

function toBookFileRef(file: BookDetail['files'][number]): BookFileRef {
  return {
    id: file.id,
    format: file.format,
    role: file.role,
    sizeBytes: file.sizeBytes,
  }
}

export function mergeBookCardWithDetail(book: BookCard, detail: BookDetail): BookCard {
  return {
    ...book,
    status: detail.status,
    title: detail.title,
    subtitle: detail.subtitle,
    isbn13: detail.isbn13,
    publisher: detail.publisher,
    publishedYear: detail.publishedYear,
    language: detail.language,
    pageCount: detail.pageCount,
    seriesName: detail.seriesName,
    seriesIndex: detail.seriesIndex,
    rating: detail.rating,
    authors: detail.authors.map((author) => author.name),
    genres: detail.genres,
    files: detail.files.map(toBookFileRef),
    readStatus: detail.readStatus,
    metadataScore: detail.metadataScore,
    hasCover: detail.coverSource !== null,
    hasMetadataLocks: detail.lockedFields.length > 0,
    lockedFields: detail.lockedFields,
    narrators: detail.audioMetadata?.narrators.map((narrator) => narrator.name) ?? [],
  }
}

function sameStringArray(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

function sameFiles(a: BookFileRef[], b: BookFileRef[]) {
  if (a.length !== b.length) return false
  return a.every((file, index) => {
    const other = b[index]
    if (!other) return false
    return file.id === other.id && file.format === other.format && file.role === other.role && file.sizeBytes === other.sizeBytes
  })
}

function sameReadStatus(a: BookCard['readStatus'], b: BookCard['readStatus']) {
  if (a === b) return true
  if (!a || !b) return false
  return a.status === b.status && a.startedAt === b.startedAt && a.finishedAt === b.finishedAt && a.updatedAt === b.updatedAt
}

export function detectChangedColumns(previous: BookCard, next: BookCard): ColumnId[] {
  const changed = new Set<ColumnId>()

  if (previous.title !== next.title) changed.add('title')
  if (previous.subtitle !== next.subtitle) changed.add('subtitle')
  if (!sameStringArray(previous.authors, next.authors)) changed.add('authors')
  if (previous.seriesName !== next.seriesName) changed.add('seriesName')
  if (previous.seriesIndex !== next.seriesIndex) changed.add('seriesIndex')
  if (previous.publishedYear !== next.publishedYear) changed.add('publishedYear')
  if (previous.language !== next.language) changed.add('language')
  if (previous.rating !== next.rating) changed.add('rating')
  if (!sameStringArray(previous.genres, next.genres)) changed.add('genres')
  if (previous.publisher !== next.publisher) changed.add('publisher')
  if (previous.pageCount !== next.pageCount) changed.add('pageCount')
  if (previous.isbn13 !== next.isbn13) changed.add('isbn13')
  if (!sameStringArray(previous.narrators, next.narrators)) changed.add('narrators')
  if (previous.readingProgress !== next.readingProgress) changed.add('readingProgress')
  if (!sameReadStatus(previous.readStatus, next.readStatus)) {
    changed.add('readStatus')
    changed.add('finishedAt')
  }
  if (previous.updatedAt !== next.updatedAt) changed.add('updatedAt')
  if (previous.addedAt !== next.addedAt) changed.add('addedAt')
  if (previous.hasCover !== next.hasCover || !sameFiles(previous.files, next.files)) {
    changed.add('cover')
    changed.add('format')
    changed.add('fileSize')
  }

  return [...changed]
}
