import type { FileMetadata } from '../composables/useFileMetadata'
import type { MetadataPatch } from '../composables/useMetadataDiff'

const FILE_METADATA_PATCH_FIELDS = [
  'title',
  'subtitle',
  'description',
  'publisher',
  'publishedYear',
  'language',
  'pageCount',
  'seriesName',
  'seriesIndex',
  'isbn10',
  'isbn13',
  'googleBooksId',
  'goodreadsId',
  'amazonId',
  'hardcoverId',
  'openLibraryId',
  'itunesId',
  'audibleId',
  'comicvineId',
  'ranobedbId',
  'authors',
  'genres',
  'narrators',
  'durationSeconds',
] as const satisfies readonly (keyof FileMetadata & keyof MetadataPatch)[]

export function buildFileMetadataPatch(meta: FileMetadata): MetadataPatch {
  const patch: MetadataPatch = {}

  for (const field of FILE_METADATA_PATCH_FIELDS) {
    if (meta[field] !== undefined) {
      patch[field] = meta[field] as never
    }
  }

  if (meta.comicMetadata !== undefined) {
    patch.comicMetadata = meta.comicMetadata
  }

  return patch
}
