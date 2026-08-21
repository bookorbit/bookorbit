// Terms that stay in English in their software context. Scoped per locale because only these
// locales have been reviewed: several others translate the term deliberately, for example zh
// renders the OIDC slug as an identifier, and that is a Crowdin decision rather than a defect.
export const PROTECTED_SOURCE_TERMS = [
  { key: 'settings.oidc.form.slug', locales: ['es', 'fr', 'it', 'pl'] },
  { key: 'annotations.hub.exportMarkdown', locales: ['es', 'fr', 'it', 'pl'] },
]

export function findProtectedTermDrift({ catalogs, terms = PROTECTED_SOURCE_TERMS }) {
  const reference = catalogs.get('en')
  if (!reference) throw new Error('English reference catalog is required')

  const drift = []
  for (const { key, locales } of terms) {
    const source = reference.get(key)
    if (source === undefined) throw new Error(`Protected term ${key} is missing from the English catalog`)
    for (const locale of locales) {
      const message = catalogs.get(locale)?.get(key)
      if (message !== undefined && message !== source) drift.push({ locale, key, message, source })
    }
  }

  return drift
}
