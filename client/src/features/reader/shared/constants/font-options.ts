export interface ReaderBuiltInFontOption {
  value: string | null
  labelKey: string
}

/**
 * Deliberately short: the real decision is serif vs sans, and named families duplicate what
 * the generic keywords already resolve to while falling back unpredictably per platform.
 * Readers who want a specific face upload it as a user or server font.
 */
export const BUILTIN_READER_FONT_OPTIONS: ReaderBuiltInFontOption[] = [
  { value: null, labelKey: 'reader.settings.fonts.bookDefault' },
  { value: 'serif', labelKey: 'reader.settings.fonts.serif' },
  { value: 'sans-serif', labelKey: 'reader.settings.fonts.sansSerif' },
  { value: 'monospace', labelKey: 'reader.settings.fonts.monospace' },
]
