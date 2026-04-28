export interface ReaderBuiltInFontOption {
  value: string | null
  label: string
}

export const BUILTIN_READER_FONT_OPTIONS: ReaderBuiltInFontOption[] = [
  { value: null, label: 'Book default' },
  { value: 'serif', label: 'Serif' },
  { value: 'sans-serif', label: 'Sans-serif' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Palatino Linotype, Palatino, Book Antiqua, serif', label: 'Palatino' },
]
