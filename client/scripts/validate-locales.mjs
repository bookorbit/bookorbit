import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { validateLocaleMessage, validateSlotCountMessage } from './locale-message-validation.mjs'

const clientRoot = fileURLToPath(new URL('..', import.meta.url))
const localesDirectory = path.join(clientRoot, 'src/locales')
const localeTypesPath = path.join(clientRoot, '../packages/types/src/locale.ts')

function flatten(value, prefix = '', output = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const messageKey = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'string') output.set(messageKey, child)
    else if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, messageKey, output)
    else throw new Error(`${messageKey} must be a string or message object`)
  }
  return output
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') return []
        return sourceFiles(entryPath)
      }
      return entry.isFile() && /\.(ts|vue)$/.test(entry.name) && !/\.(spec|test)\.ts$/.test(entry.name) ? [entryPath] : []
    }),
  )
  return files.flat()
}

async function sourceMessageKeys() {
  const sourceDirectory = path.join(clientRoot, 'src')
  const files = await sourceFiles(sourceDirectory)
  const keys = new Set()
  const slotCountKeys = new Set()

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/(?<![\w$])(?:\$?t|\$?tc|\$?te)\(\s*(['"])([A-Za-z0-9_.-]+)\1/g)) {
      keys.add(match[2])
    }
    for (const match of source.matchAll(/<i18n-t\b[^>]*\bkeypath\s*=\s*(['"])([A-Za-z0-9_.-]+)\1/g)) {
      keys.add(match[2])
    }
    for (const match of source.matchAll(/<IcuCountText\b[^>]*\bkeypath\s*=\s*(['"])([A-Za-z0-9_.-]+)\1/g)) {
      keys.add(match[2])
      slotCountKeys.add(match[2])
    }
  }

  return { keys, slotCountKeys }
}

const localeTypes = await readFile(localeTypesPath, 'utf8')
const supportedMatch = localeTypes.match(/SUPPORTED_LOCALES\s*=\s*(\[[\s\S]*?\])\s+as const/)
if (!supportedMatch) throw new Error('Unable to read SUPPORTED_LOCALES from packages/types/src/locale.ts')
// Prettier wraps the array once the locale list outgrows the print width, which
// adds a trailing comma that JSON.parse rejects.
const supportedLocales = JSON.parse(supportedMatch[1].replace(/,(\s*])$/, '$1'))

const localeFiles = (await readdir(localesDirectory)).filter((file) => file.endsWith('.json')).sort()
const expectedFiles = supportedLocales.map((locale) => `${locale}.json`).sort()
if (JSON.stringify(localeFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(`Locale files do not match SUPPORTED_LOCALES: expected ${expectedFiles.join(', ')}, found ${localeFiles.join(', ')}`)
}

const catalogs = new Map()
for (const locale of supportedLocales) {
  const raw = await readFile(path.join(localesDirectory, `${locale}.json`), 'utf8')
  catalogs.set(locale, flatten(JSON.parse(raw)))
}

const reference = catalogs.get('en')
if (!reference) throw new Error('English reference catalog is required')

const errors = []
const { keys: referencedKeys, slotCountKeys } = await sourceMessageKeys()
for (const key of referencedKeys) {
  if (!reference.has(key)) errors.push(`en: missing key referenced in source ${key}`)
}

for (const [locale, catalog] of catalogs) {
  for (const [key, referenceMessage] of reference) {
    const message = catalog.get(key)
    if (message === undefined) {
      errors.push(`${locale}: missing key ${key}`)
      continue
    }
    if (message.length === 0) errors.push(`${locale}: empty message ${key}`)
    if (message.includes('\u2014')) errors.push(`${locale}: Unicode em dash is not allowed in ${key}`)
    if (/<[^>]+>/.test(message)) errors.push(`${locale}: HTML is not allowed in ${key}`)
    errors.push(...validateLocaleMessage({ key, locale, message, referenceMessage }))
    if (slotCountKeys.has(key)) errors.push(...validateSlotCountMessage({ key, locale, message }))
  }
  for (const key of catalog.keys()) {
    if (!reference.has(key)) errors.push(`${locale}: unexpected key ${key}`)
  }
}

if (errors.length > 0) {
  throw new Error(`Locale validation failed:\n${errors.join('\n')}`)
}

console.log(`Validated ${supportedLocales.length} locale catalogs with ${reference.size} messages each`)
