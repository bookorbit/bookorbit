const FONT_METADATA_TOKENS = /\b(?:variablefont|wght|wdth|ital|opsz|slnt)\b/gi

export function formatFontFamilyLabel(name: string): string {
  const normalized = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  if (!normalized) return name

  const stripped = normalized.replace(FONT_METADATA_TOKENS, '').replace(/\s+/g, ' ').trim()
  return stripped || normalized
}
