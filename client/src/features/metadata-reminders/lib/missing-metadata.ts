import { getBookMediaProfile, type BookDetailFile, type MetadataReminderField } from '@bookorbit/types'

type ReminderMetadata = {
  publisher: string | null
  language: string | null
  publishedYear: number | null
  publishedDate: string | null
  pageCount: number | null
  isbn10: string | null
  isbn13: string | null
  genres: string[]
  tags: string[]
  description: string | null
}

export function missingMetadataFields(
  metadata: ReminderMetadata,
  files: readonly Pick<BookDetailFile, 'format' | 'role'>[],
  enabledFields: readonly MetadataReminderField[],
): MetadataReminderField[] {
  const contentFiles = files.filter((file) => file.role === 'content' || file.role === 'primary')
  const media = getBookMediaProfile(contentFiles)
  const audioOnly = media.hasAudio && !media.hasEbook && !media.hasComic
  const filled: Record<MetadataReminderField, boolean> = {
    publisher: Boolean(metadata.publisher?.trim()),
    language: Boolean(metadata.language?.trim()),
    publication: metadata.publishedYear != null || Boolean(metadata.publishedDate?.trim()),
    pageCount: audioOnly || metadata.pageCount != null,
    isbn: Boolean(metadata.isbn10?.trim() || metadata.isbn13?.trim()),
    genres: metadata.genres.some((genre) => Boolean(genre.trim())),
    tags: metadata.tags.some((tag) => Boolean(tag.trim())),
    description: Boolean(metadata.description?.trim()),
  }
  return enabledFields.filter((field) => !filled[field])
}
