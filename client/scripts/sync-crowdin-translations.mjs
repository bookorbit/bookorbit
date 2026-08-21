import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { TARGET_CATALOGS, assertCrowdinTargetConfiguration } from './locale-configuration.mjs'
import { findInvalidTargetMessages, flattenCatalog, validateCatalogs } from './locale-catalog-validation.mjs'
import { collectSourceMessageKeys } from './locale-source-keys.mjs'

const API = 'https://api.crowdin.com/api/v2'
const SOURCE_PATH_SUFFIX = '/client/src/locales/en.json'
const MAX_API_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_CATALOG_BYTES = 10 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000
const scriptDirectory = import.meta.dirname ?? path.join(process.cwd(), 'scripts')
const clientRoot = path.resolve(scriptDirectory, '..')
const localesDirectory = path.join(clientRoot, 'src/locales')

export { TARGET_CATALOGS }

const TARGET_LOCALES = new Set(TARGET_CATALOGS.map(({ locale }) => locale))

async function responseText(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Response exceeds ${maxBytes} bytes`)
  }

  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`Response exceeds ${maxBytes} bytes`)
    }
    chunks.push(Buffer.from(value))
  }

  return Buffer.concat(chunks).toString('utf8')
}

function parseJson(text, context) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${context} returned invalid JSON`)
  }
}

function ipv4Value(hostname) {
  return hostname.split('.').reduce((value, octet) => value * 256 + Number(octet), 0) >>> 0
}

function isInIpv4Range(value, network, prefixLength) {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0
  return (value & mask) === (network & mask)
}

function isBlockedIpv4(hostname) {
  const value = ipv4Value(hostname)
  return [
    [ipv4Value('0.0.0.0'), 8],
    [ipv4Value('10.0.0.0'), 8],
    [ipv4Value('100.64.0.0'), 10],
    [ipv4Value('127.0.0.0'), 8],
    [ipv4Value('169.254.0.0'), 16],
    [ipv4Value('172.16.0.0'), 12],
    [ipv4Value('192.0.0.0'), 24],
    [ipv4Value('192.0.2.0'), 24],
    [ipv4Value('192.168.0.0'), 16],
    [ipv4Value('198.18.0.0'), 15],
    [ipv4Value('198.51.100.0'), 24],
    [ipv4Value('203.0.113.0'), 24],
    [ipv4Value('224.0.0.0'), 4],
    [ipv4Value('240.0.0.0'), 4],
  ].some(([network, prefixLength]) => isInIpv4Range(value, network, prefixLength))
}

function ipv6Groups(hostname) {
  const [head, tail = ''] = hostname.split('::')
  const headGroups = head ? head.split(':').map((group) => Number.parseInt(group, 16)) : []
  const tailGroups = tail ? tail.split(':').map((group) => Number.parseInt(group, 16)) : []
  return [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill(0), ...tailGroups]
}

function isBlockedIpv6(hostname) {
  const groups = ipv6Groups(hostname)
  const first = groups[0]
  const ipv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
  if (ipv4Mapped) {
    const embedded = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
    return isBlockedIpv4(embedded)
  }

  return (
    groups.every((group) => group === 0) ||
    (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) ||
    groups.slice(0, 6).every((group) => group === 0) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00
  )
}

export function assertSafeDownloadUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('Crowdin export URL must use HTTPS')

  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()
  const addressType = isIP(hostname)
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Crowdin export URL must not target a local network host')
  }
  if ((addressType === 4 && isBlockedIpv4(hostname)) || (addressType === 6 && isBlockedIpv6(hostname))) {
    throw new Error('Crowdin export URL must not target a local network host')
  }

  return url
}

async function downloadCatalog(fetchImpl, value) {
  let url = assertSafeDownloadUrl(value)

  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirect === 3) throw new Error('Crowdin export exceeded the redirect limit')
      url = assertSafeDownloadUrl(new URL(location, url).href)
      continue
    }
    if (!response.ok) throw new Error(`Crowdin export download failed with HTTP ${response.status}`)
    return parseJson(await responseText(response, MAX_CATALOG_BYTES), 'Crowdin export')
  }

  throw new Error('Crowdin export exceeded the redirect limit')
}

export function createCrowdinClient({ token, projectId, fetchImpl = fetch }) {
  async function request(endpoint, init = {}) {
    const response = await fetchImpl(`${API}${endpoint}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const body = await responseText(response, MAX_API_RESPONSE_BYTES)
    if (!response.ok) throw new Error(`Crowdin API ${endpoint} failed with HTTP ${response.status}: ${body.slice(0, 300)}`)
    return body ? parseJson(body, `Crowdin API ${endpoint}`) : null
  }

  return {
    async sourceFileId() {
      for (let offset = 0; offset < 10_000; offset += 500) {
        const page = await request(`/projects/${projectId}/files?limit=500&offset=${offset}`)
        const match = page.data.find((entry) => entry.data.path.endsWith(SOURCE_PATH_SUFFIX))
        if (match) return match.data.id
        if (page.data.length < 500) break
      }
      throw new Error(`Crowdin source file ending in ${SOURCE_PATH_SUFFIX} was not found`)
    },

    async sourceIdentifiers(fileId) {
      const identifiers = new Set()
      for (let offset = 0; offset < 20_000; offset += 500) {
        const page = await request(`/projects/${projectId}/strings?fileId=${fileId}&limit=500&offset=${offset}`)
        for (const entry of page.data) identifiers.add(entry.data.identifier)
        if (page.data.length < 500) return identifiers
      }
      throw new Error('Crowdin source contains more than 20,000 messages')
    },

    async exportedCatalog(fileId, languageId) {
      const build = await request(`/projects/${projectId}/translations/builds/files/${fileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetLanguageId: languageId, skipUntranslatedStrings: true }),
      })
      return downloadCatalog(fetchImpl, build.data.url)
    },
  }
}

function orderedSparseCatalog(reference, messages, prefix = '') {
  const output = {}
  for (const [key, child] of Object.entries(reference)) {
    const messageKey = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'string') {
      const translated = messages.get(messageKey)
      if (translated !== undefined) output[key] = translated
      continue
    }

    const nested = orderedSparseCatalog(child, messages, messageKey)
    if (Object.keys(nested).length > 0) output[key] = nested
  }
  return output
}

export function normalizeCrowdinCatalog(exported, reference) {
  const referenceMessages = flattenCatalog(reference)
  const exportedMessages = flattenCatalog(exported)

  for (const key of exportedMessages.keys()) {
    if (!referenceMessages.has(key)) throw new Error(`Crowdin export contains unknown key ${key}`)
  }
  for (const [key, message] of exportedMessages) {
    if (message.length === 0) exportedMessages.delete(key)
  }

  return orderedSparseCatalog(reference, exportedMessages)
}

async function mapWithConcurrency(values, concurrency, operation) {
  const results = new Array(values.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await operation(values[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return results
}

export function sourceDrift(referenceMessages, identifiers) {
  const missing = [...referenceMessages.keys()].filter((key) => !identifiers.has(key))
  const unexpected = [...identifiers].filter((key) => !referenceMessages.has(key))
  return { missing, unexpected }
}

export function parseAllowedTranslationLosses(value = '') {
  const allowed = new Set()
  for (const entry of value.split(/[\s,]+/).filter(Boolean)) {
    const separator = entry.indexOf(':')
    const locale = entry.slice(0, separator)
    const key = entry.slice(separator + 1)
    if (separator < 1 || !TARGET_LOCALES.has(locale) || !/^[A-Za-z0-9_.-]+$/.test(key)) {
      throw new Error(`Invalid translation loss acknowledgement ${entry}; expected locale:message.key`)
    }
    if (allowed.has(entry)) throw new Error(`Duplicate translation loss acknowledgement ${entry}`)
    allowed.add(entry)
  }
  return allowed
}

// Exports are built with skipUntranslatedStrings, so Crowdin drops a key entirely once it stops
// carrying a translation. Retention therefore compares presence, never message content: a translation
// that equals the English source, such as Spanish "Error" or a product name, is a real translation.
export function findTranslationLosses({ locale, reference, current, exported, rejected = new Map() }) {
  const losses = []

  for (const key of current.keys()) {
    if (!reference.has(key) || exported.has(key)) continue

    const rejection = rejected.get(key)
    losses.push({ locale, key, reason: rejection ? `rejected by catalog validation - ${rejection[0]}` : 'missing from Crowdin export' })
  }

  return losses
}

export function assertTranslationRetention({
  reference,
  currentCatalogs,
  exportedCatalogs,
  allowedLosses = new Set(),
  targetCatalogs = TARGET_CATALOGS,
  rejections = [],
}) {
  const rejectedByLocale = new Map()
  for (const { locale, key, errors } of rejections) {
    if (!rejectedByLocale.has(locale)) rejectedByLocale.set(locale, new Map())
    rejectedByLocale.get(locale).set(key, errors)
  }

  const losses = []
  for (const { locale } of targetCatalogs) {
    const current = currentCatalogs.get(locale)
    const exported = exportedCatalogs.get(locale)
    if (!current || !exported) throw new Error(`Translation retention comparison is missing the ${locale} catalog`)
    losses.push(...findTranslationLosses({ locale, reference, current, exported, rejected: rejectedByLocale.get(locale) }))
  }

  const detected = new Set(losses.map(({ locale, key }) => `${locale}:${key}`))
  const unacknowledged = losses.filter(({ locale, key }) => !allowedLosses.has(`${locale}:${key}`))
  const unused = [...allowedLosses].filter((entry) => !detected.has(entry))
  if (unacknowledged.length === 0 && unused.length === 0) return

  const details = [
    ...unacknowledged.slice(0, 25).map(({ locale, key, reason }) => `${locale}:${key} - ${reason}`),
    ...unused.slice(0, 25).map((entry) => `${entry} - acknowledgement does not match an exported loss`),
  ]
  const remaining = unacknowledged.length + unused.length - details.length
  if (remaining > 0) details.push(`...and ${remaining} more`)
  throw new Error(`Crowdin export would lose existing translations:\n${details.join('\n')}`)
}

const MAX_REPORTED_REJECTIONS = 50

export function formatRejectionReport(rejections) {
  if (rejections.length === 0) return ''

  const listed = rejections.slice(0, MAX_REPORTED_REJECTIONS)
  const lines = [
    `### Rejected Crowdin messages (${rejections.length})`,
    '',
    'These translations did not pass catalog validation and were omitted, so the English source renders instead. Fix them in Crowdin.',
    '',
    ...listed.map(({ errors }) => `- ${errors[0]}`),
  ]
  if (rejections.length > listed.length) lines.push(`- ...and ${rejections.length - listed.length} more`)
  return `${lines.join('\n')}\n`
}

async function reportRejections(rejections, reportPath) {
  if (rejections.length === 0) {
    if (reportPath) await writeFile(reportPath, '')
    return
  }

  console.log(`Rejected ${rejections.length} invalid Crowdin messages; the English source renders instead:`)
  for (const { errors } of rejections.slice(0, MAX_REPORTED_REJECTIONS)) console.log(`  ${errors[0]}`)
  if (rejections.length > MAX_REPORTED_REJECTIONS) console.log(`  ...and ${rejections.length - MAX_REPORTED_REJECTIONS} more`)
  if (reportPath) await writeFile(reportPath, formatRejectionReport(rejections))
}

export async function syncCrowdinTranslations({
  token,
  projectId = '912891',
  fetchImpl = fetch,
  catalogDirectory = localesDirectory,
  outputDirectory = catalogDirectory,
  allowedLosses = new Set(),
  targetCatalogs = TARGET_CATALOGS,
  assertTargetConfiguration = assertCrowdinTargetConfiguration,
  collectMessageKeys = collectSourceMessageKeys,
  reportPath = process.env.CROWDIN_REJECTION_REPORT || '',
}) {
  if (!token) throw new Error('CROWDIN_TOKEN is required')
  await assertTargetConfiguration()

  const reference = JSON.parse(await readFile(path.join(catalogDirectory, 'en.json'), 'utf8'))
  const referenceMessages = flattenCatalog(reference)
  const currentCatalogs = new Map(
    await Promise.all(
      targetCatalogs.map(async ({ locale }) => {
        const catalog = JSON.parse(await readFile(path.join(catalogDirectory, `${locale}.json`), 'utf8'))
        return [locale, flattenCatalog(catalog)]
      }),
    ),
  )
  const client = createCrowdinClient({ token, projectId, fetchImpl })
  const fileId = await client.sourceFileId()
  const identifiers = await client.sourceIdentifiers(fileId)
  const drift = sourceDrift(referenceMessages, identifiers)
  if (drift.missing.length > 0 || drift.unexpected.length > 0) {
    const details = [
      ...drift.missing.slice(0, 10).map((key) => `missing in Crowdin: ${key}`),
      ...drift.unexpected.slice(0, 10).map((key) => `missing in Git: ${key}`),
    ]
    throw new Error(`Crowdin source is not synchronized with en.json\n${details.join('\n')}`)
  }

  const downloaded = await mapWithConcurrency(targetCatalogs, 4, async ({ languageId, locale }) => ({
    locale,
    catalog: normalizeCrowdinCatalog(await client.exportedCatalog(fileId, languageId), reference),
  }))
  const catalogs = new Map([['en', referenceMessages]])
  for (const { locale, catalog } of downloaded) catalogs.set(locale, flattenCatalog(catalog))

  const { slotCountKeys } = await collectMessageKeys()
  const rejections = findInvalidTargetMessages({ catalogs, slotCountKeys })
  const rejectedLocales = new Set(rejections.map(({ locale }) => locale))
  for (const { locale, key } of rejections) catalogs.get(locale).delete(key)
  for (const entry of downloaded) {
    if (rejectedLocales.has(entry.locale)) entry.catalog = orderedSparseCatalog(reference, catalogs.get(entry.locale))
  }

  const errors = validateCatalogs({ catalogs, slotCountKeys })
  if (errors.length > 0) throw new Error(`Crowdin export validation failed:\n${errors.join('\n')}`)
  assertTranslationRetention({
    reference: referenceMessages,
    currentCatalogs,
    exportedCatalogs: catalogs,
    allowedLosses,
    targetCatalogs,
    rejections,
  })

  await mkdir(outputDirectory, { recursive: true })
  await Promise.all(
    downloaded.map(({ locale, catalog }) => writeFile(path.join(outputDirectory, `${locale}.json`), `${JSON.stringify(catalog, null, 2)}\n`)),
  )
  await reportRejections(rejections, reportPath)
  console.log(`Synchronized ${downloaded.length} sparse translation catalogs from Crowdin`)
  return { rejections }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncCrowdinTranslations({
    token: process.env.CROWDIN_TOKEN,
    projectId: process.env.CROWDIN_PROJECT_ID || undefined,
    allowedLosses: parseAllowedTranslationLosses(process.env.CROWDIN_ALLOWED_TRANSLATION_LOSSES),
  }).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
