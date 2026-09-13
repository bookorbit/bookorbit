import { completePluralCategories } from './locale-message-validation.mjs'

// Catalogs never carry a Unicode em dash. That is a house style rule rather than a correctness one,
// and translators reach for the character constantly, so rejecting the message would discard a sound
// translation over punctuation and stall the sync until somebody edits Crowdin by hand. The English
// source writes a plain hyphen in the same place, so the sync rewrites the character instead.
export function normalizeMessageTypography(message) {
  return message.replaceAll('\u2014', '-')
}

// Repairs applied to a Crowdin export before validation. Each one keeps a translation that is sound
// apart from a mechanical defect, and each disappears on its own once Crowdin carries a clean
// message, so nothing here hides a translation problem from the pull request body.
export function findExportRepairs({ catalogs }) {
  const repairs = []
  for (const [locale, catalog] of catalogs) {
    if (locale === 'en') continue

    for (const [key, message] of catalog) {
      const kinds = []
      const normalized = normalizeMessageTypography(message)
      if (normalized !== message) kinds.push('typography')

      const completed = completePluralCategories({ locale, message: normalized })
      if (completed) kinds.push('plural categories')

      if (kinds.length > 0) repairs.push({ locale, key, message: completed ?? normalized, kinds })
    }
  }

  return repairs
}
