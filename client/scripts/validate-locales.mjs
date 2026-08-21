import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SUPPORTED_LOCALES } from './locale-configuration.mjs'
import { flattenCatalog, validateCatalogs } from './locale-catalog-validation.mjs'
import { collectSourceMessageKeys } from './locale-source-keys.mjs'
import { findProtectedTermDrift } from './locale-protected-terms.mjs'

const clientRoot = fileURLToPath(new URL('..', import.meta.url))
const localesDirectory = path.join(clientRoot, 'src/locales')

const localeFiles = (await readdir(localesDirectory)).filter((file) => file.endsWith('.json')).sort()
const expectedFiles = SUPPORTED_LOCALES.map((locale) => `${locale}.json`).sort()
if (JSON.stringify(localeFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(`Locale files do not match SUPPORTED_LOCALES: expected ${expectedFiles.join(', ')}, found ${localeFiles.join(', ')}`)
}

const catalogs = new Map()
for (const locale of SUPPORTED_LOCALES) {
  const raw = await readFile(path.join(localesDirectory, `${locale}.json`), 'utf8')
  catalogs.set(locale, flattenCatalog(JSON.parse(raw)))
}

const reference = catalogs.get('en')
if (!reference) throw new Error('English reference catalog is required')

const { keys: referencedKeys, slotCountKeys } = await collectSourceMessageKeys()
const errors = validateCatalogs({ catalogs, referencedKeys, slotCountKeys })
for (const { locale, key, message } of findProtectedTermDrift({ catalogs })) {
  errors.push(`${locale}: protected term ${key} must keep the English source text, found "${message}"`)
}

if (errors.length > 0) {
  throw new Error(`Locale validation failed:\n${errors.join('\n')}`)
}

console.log(`Validated ${SUPPORTED_LOCALES.length} locale catalogs against ${reference.size} English messages`)
