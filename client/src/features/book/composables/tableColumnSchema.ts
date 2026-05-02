import type { BookCard, BookMetadataLockField, SortField } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'

function getPrimaryFile(book: BookCard) {
  return book.files.find((f) => f.role === 'primary') ?? book.files[0] ?? null
}

export type ColumnId =
  | 'lockRow'
  | 'cover'
  | 'title'
  | 'authors'
  | 'seriesName'
  | 'seriesIndex'
  | 'publishedYear'
  | 'language'
  | 'rating'
  | 'genres'
  | 'tags'
  | 'subtitle'
  | 'publisher'
  | 'pageCount'
  | 'isbn13'
  | 'narrators'
  | 'readingProgress'
  | 'finishedAt'
  | 'readStatus'
  | 'format'
  | 'fileSize'
  | 'updatedAt'
  | 'addedAt'
  | 'actions'

export type CellType = 'lockRow' | 'cover' | 'text' | 'number' | 'rating' | 'chips' | 'readStatus' | 'format' | 'date' | 'progress' | 'actions'

export type ColumnDef = {
  id: ColumnId
  header: string
  cellType: CellType
  isEditable: boolean
  sortField: SortField | null
  defaultWidth: number
  minWidth: number
  defaultVisible: boolean
  pinned: 'left' | 'right' | null
  accessor?: (book: BookCard) => unknown
  lockField?: BookMetadataLockField
}

export const LOCK_ROW_COLUMN_DEF: ColumnDef = {
  id: 'lockRow',
  header: '',
  cellType: 'lockRow',
  isEditable: false,
  sortField: null,
  defaultWidth: 36,
  minWidth: 36,
  defaultVisible: false,
  pinned: 'left',
}

export const COLUMN_DEFS: ColumnDef[] = [
  {
    id: 'cover',
    header: '',
    cellType: 'cover',
    isEditable: false,
    sortField: null,
    defaultWidth: 48,
    minWidth: 48,
    defaultVisible: true,
    pinned: 'left',
  },
  {
    id: 'title',
    header: 'Title',
    cellType: 'text',
    isEditable: true,
    sortField: 'title',
    defaultWidth: 240,
    minWidth: 120,
    defaultVisible: true,
    pinned: null,
    accessor: (book) => book.title,
    lockField: 'title',
  },
  {
    id: 'authors',
    header: 'Authors',
    cellType: 'chips',
    isEditable: true,
    sortField: 'author',
    defaultWidth: 180,
    minWidth: 100,
    defaultVisible: true,
    pinned: null,
    accessor: (book) => book.authors,
    lockField: 'authors',
  },
  {
    id: 'seriesName',
    header: 'Series',
    cellType: 'text',
    isEditable: true,
    sortField: 'series',
    defaultWidth: 160,
    minWidth: 100,
    defaultVisible: true,
    pinned: null,
    accessor: (book) => book.seriesName,
    lockField: 'seriesName',
  },
  {
    id: 'seriesIndex',
    header: '#',
    cellType: 'number',
    isEditable: true,
    sortField: 'seriesIndex',
    defaultWidth: 60,
    minWidth: 48,
    defaultVisible: true,
    pinned: null,
    accessor: (book) => book.seriesIndex,
    lockField: 'seriesIndex',
  },
  {
    id: 'publishedYear',
    header: 'Year',
    cellType: 'number',
    isEditable: true,
    sortField: 'publishedYear',
    defaultWidth: 110,
    minWidth: 95,
    defaultVisible: true,
    pinned: null,
    accessor: (book) => book.publishedYear,
    lockField: 'publishedYear',
  },
  {
    id: 'language',
    header: 'Language',
    cellType: 'text',
    isEditable: true,
    sortField: 'language',
    defaultWidth: 100,
    minWidth: 72,
    defaultVisible: false,
    pinned: null,
    accessor: (book) => book.language,
    lockField: 'language',
  },
  {
    id: 'rating',
    header: 'Rating',
    cellType: 'rating',
    isEditable: true,
    sortField: 'rating',
    defaultWidth: 110,
    minWidth: 88,
    defaultVisible: true,
    pinned: null,
    accessor: (book) => book.rating,
    lockField: 'rating',
  },
  {
    id: 'genres',
    header: 'Genres',
    cellType: 'chips',
    isEditable: true,
    sortField: null,
    defaultWidth: 160,
    minWidth: 100,
    defaultVisible: false,
    pinned: null,
    accessor: (book) => book.genres,
    lockField: 'genres',
  },
  {
    id: 'tags',
    header: 'Tags',
    cellType: 'chips',
    isEditable: true,
    sortField: null,
    defaultWidth: 160,
    minWidth: 100,
    defaultVisible: false,
    pinned: null,
    accessor: (book) => book.tags ?? [],
    lockField: 'tags',
  },
  {
    id: 'subtitle',
    header: 'Subtitle',
    cellType: 'text',
    isEditable: true,
    sortField: null,
    defaultWidth: 200,
    minWidth: 100,
    defaultVisible: false,
    pinned: null,
    accessor: (book) => book.subtitle,
    lockField: 'subtitle',
  },
  {
    id: 'publisher',
    header: 'Publisher',
    cellType: 'text',
    isEditable: true,
    sortField: 'publisher',
    defaultWidth: 140,
    minWidth: 80,
    defaultVisible: false,
    pinned: null,
    accessor: (book) => book.publisher,
    lockField: 'publisher',
  },
  {
    id: 'pageCount',
    header: 'Pages',
    cellType: 'number',
    isEditable: true,
    sortField: 'pageCount',
    defaultWidth: 80,
    minWidth: 60,
    defaultVisible: false,
    pinned: null,
    accessor: (book) => book.pageCount,
    lockField: 'pageCount',
  },
  {
    id: 'isbn13',
    header: 'ISBN-13',
    cellType: 'text',
    isEditable: false,
    sortField: null,
    defaultWidth: 150,
    minWidth: 100,
    defaultVisible: false,
    pinned: null,
    accessor: (book) => book.isbn13,
  },
  {
    id: 'narrators',
    header: 'Narrators',
    cellType: 'chips',
    isEditable: true,
    sortField: null,
    defaultWidth: 180,
    minWidth: 100,
    defaultVisible: false,
    pinned: null,
    accessor: (book) => book.narrators,
    lockField: 'narrators',
  },
  {
    id: 'readingProgress',
    header: 'Progress',
    cellType: 'progress',
    isEditable: false,
    sortField: 'readProgress',
    defaultWidth: 120,
    minWidth: 80,
    defaultVisible: false,
    pinned: null,
    accessor: (book) => book.readingProgress,
  },
  {
    id: 'finishedAt',
    header: 'Date Read',
    cellType: 'date',
    isEditable: false,
    sortField: 'finishedAt',
    defaultWidth: 110,
    minWidth: 80,
    defaultVisible: false,
    pinned: null,
    accessor: (book) => book.readStatus?.finishedAt ?? null,
  },
  {
    id: 'readStatus',
    header: 'Status',
    cellType: 'readStatus',
    isEditable: true,
    sortField: 'readStatus',
    defaultWidth: 130,
    minWidth: 100,
    defaultVisible: true,
    pinned: null,
    accessor: (book) => book.readStatus,
  },
  {
    id: 'format',
    header: 'Format',
    cellType: 'format',
    isEditable: false,
    sortField: 'format',
    defaultWidth: 80,
    minWidth: 64,
    defaultVisible: true,
    pinned: null,
  },
  {
    id: 'fileSize',
    header: 'File Size',
    cellType: 'text',
    isEditable: false,
    sortField: 'fileSize',
    defaultWidth: 100,
    minWidth: 84,
    defaultVisible: true,
    pinned: null,
    accessor: (book) => formatBytes(getPrimaryFile(book)?.sizeBytes ?? null),
  },
  {
    id: 'updatedAt',
    header: 'Updated',
    cellType: 'date',
    isEditable: false,
    sortField: 'updatedAt',
    defaultWidth: 110,
    minWidth: 84,
    defaultVisible: false,
    pinned: null,
    accessor: (book) => book.updatedAt ?? null,
  },
  {
    id: 'addedAt',
    header: 'Added',
    cellType: 'date',
    isEditable: false,
    sortField: 'addedAt',
    defaultWidth: 100,
    minWidth: 80,
    defaultVisible: false,
    pinned: null,
    accessor: (book) => book.addedAt,
  },
  {
    id: 'actions',
    header: '',
    cellType: 'actions',
    isEditable: false,
    sortField: null,
    defaultWidth: 48,
    minWidth: 48,
    defaultVisible: true,
    pinned: 'right',
  },
]

export const COLUMN_DEF_MAP = new Map(COLUMN_DEFS.map((c) => [c.id, c]))

export const DEFAULT_ORDER: ColumnId[] = COLUMN_DEFS.map((c) => c.id)
export const DEFAULT_HIDDEN: ColumnId[] = COLUMN_DEFS.filter((c) => !c.defaultVisible).map((c) => c.id)
export const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(COLUMN_DEFS.map((c) => [c.id, c.defaultWidth]))
