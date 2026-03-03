export type ReaderFormatGroup = 'epub' | 'pdf' | 'cbx'

export const FORMAT_TO_GROUP: Record<string, ReaderFormatGroup> = {
  epub: 'epub',
  mobi: 'epub',
  azw3: 'epub',
  azw: 'epub',
  fb2: 'epub',
  txt: 'epub',
  pdf: 'pdf',
  cbz: 'cbx',
  cbr: 'cbx',
  cb7: 'cbx',
}

export function getFormatGroup(format: string): ReaderFormatGroup {
  return FORMAT_TO_GROUP[format.toLowerCase()] ?? 'epub'
}

export interface EpubReaderSettings {
  themeName: string // matches one of the reader's built-in theme names
  isDark: boolean
  fontFamily: string | null // null = use the book's embedded font
  fontSize: number // 10-32
  lineHeight: number // 0.8-3.0
  maxColumnCount: number // 1-10
  gap: number // 0-0.5 (column gap as fraction)
  maxInlineSize: number // 400-1600 (max content width in px)
  maxBlockSize: number // 600-2400 (max content height in px)
  justify: boolean
  hyphenate: boolean
  flow: 'paginated' | 'scrolled'
  // When false, new books open with the publisher's embedded styles instead of these defaults.
  // Per-book settings always apply regardless of this flag.
  overrideBookFormatting: boolean
}

export interface PdfReaderSettings {
  scrollMode: 'vertical' | 'horizontal' | 'wrapped' | 'page'
  spread: 'none' | 'odd' | 'even'
  zoomMode: 'fit-width' | 'fit-page' | 'custom'
  customScale: number // 0.25-4.0, used when zoomMode is 'custom'
  rotation: 0 | 90 | 180 | 270
}

export interface CbxReaderSettings {
  fitMode: 'fit-page' | 'fit-width' | 'fit-height' | 'actual'
  viewMode: 'single' | 'two-page'
  scrollMode: 'paginated' | 'infinite' | 'long-strip'
  direction: 'ltr' | 'rtl'
  bgColor: 'black' | 'gray' | 'white'
}

export type ReaderSettingsMap = {
  epub: EpubReaderSettings
  pdf: PdfReaderSettings
  cbx: CbxReaderSettings
}

export type ReaderSettings = EpubReaderSettings | PdfReaderSettings | CbxReaderSettings

export const EPUB_READER_DEFAULTS: EpubReaderSettings = {
  themeName: 'default',
  isDark: false,
  fontFamily: null,
  fontSize: 16,
  lineHeight: 1.5,
  maxColumnCount: 2,
  gap: 0.05,
  maxInlineSize: 720,
  maxBlockSize: 1440,
  justify: true,
  hyphenate: true,
  flow: 'paginated',
  overrideBookFormatting: true,
}

export const PDF_READER_DEFAULTS: PdfReaderSettings = {
  scrollMode: 'vertical',
  spread: 'none',
  zoomMode: 'fit-page',
  customScale: 1.0,
  rotation: 0,
}

export const CBX_READER_DEFAULTS: CbxReaderSettings = {
  fitMode: 'fit-page',
  viewMode: 'single',
  scrollMode: 'paginated',
  direction: 'ltr',
  bgColor: 'black',
}

export const READER_GROUP_DEFAULTS: ReaderSettingsMap = {
  epub: EPUB_READER_DEFAULTS,
  pdf: PDF_READER_DEFAULTS,
  cbx: CBX_READER_DEFAULTS,
}
