import { BOOK_FILE_WRITE_FIELD_LABELS, type BookDetail, type BookFileWriteField } from '@bookorbit/types'

export type WriteBackField = {
  field: BookFileWriteField
  label: string
  /** The value that would land in the file, or null when the book has nothing to write. */
  value: string | null
}

/** A synopsis is a paragraph; in a two-column value list it only needs to prove it is there. */
const DESCRIPTION_PREVIEW_LENGTH = 90

function joinNames(values: readonly ({ name: string } | string)[] | null | undefined): string | null {
  const joined = (values ?? [])
    .map((entry) => (typeof entry === 'string' ? entry : entry.name))
    .filter(Boolean)
    .join(', ')
  return joined || null
}

function plainText(html: string | null): string | null {
  if (!html) return null
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  return text.length > DESCRIPTION_PREVIEW_LENGTH ? `${text.slice(0, DESCRIPTION_PREVIEW_LENGTH)}…` : text
}

/**
 * What write-back would actually put in the file. The tab has always been able to say which fields
 * sync; it has never been able to say what they contain, which is the question you ask before
 * letting something rewrite your library.
 */
export function resolveWriteBackFields(book: BookDetail, fields: readonly BookFileWriteField[]): WriteBackField[] {
  return fields.map((field) => ({
    field,
    label: BOOK_FILE_WRITE_FIELD_LABELS[field] ?? field,
    value: resolveValue(book, field),
  }))
}

function resolveValue(book: BookDetail, field: BookFileWriteField): string | null {
  switch (field) {
    case 'authors':
      return joinNames(book.authors)
    case 'narrators':
      return joinNames(book.audioMetadata?.narrators)
    case 'genres':
      return joinNames(book.genres)
    case 'tags':
      return joinNames(book.tags)
    case 'description':
      return plainText(book.description)
    case 'coverBytes':
      return book.coverSource
    case 'seriesIndex':
      return book.seriesIndex != null ? String(book.seriesIndex) : null
    case 'seriesName':
      return book.seriesName
    case 'comicIssueNumber':
      return book.comicMetadata?.issueNumber ?? null
    case 'comicVolumeName':
      return book.comicMetadata?.volumeName ?? null
    default: {
      const direct = (book as unknown as Record<string, unknown>)[field]
      if (direct != null && direct !== '') return Array.isArray(direct) ? joinNames(direct) : String(direct)

      const comic = book.comicMetadata as unknown as Record<string, unknown> | null
      const fromComic = comic?.[field]
      if (Array.isArray(fromComic)) return joinNames(fromComic)
      if (fromComic != null && fromComic !== '') return String(fromComic)

      // Provider ids arrive keyed without the `Id` suffix the write field carries.
      const provider = book.providerIds[field.replace(/Id$/, '') as keyof typeof book.providerIds]
      return provider != null && provider !== '' ? String(provider) : null
    }
  }
}
