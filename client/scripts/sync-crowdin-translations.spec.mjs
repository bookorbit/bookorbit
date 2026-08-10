import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertCrowdinTargetConfiguration, validateCrowdinTargetConfiguration } from './locale-configuration.mjs'
import {
  TARGET_CATALOGS,
  assertSafeDownloadUrl,
  assertTranslationRetention,
  createCrowdinClient,
  findTranslationLosses,
  normalizeCrowdinCatalog,
  parseAllowedTranslationLosses,
  sourceDrift,
  syncCrowdinTranslations,
} from './sync-crowdin-translations.mjs'

const reference = {
  common: { save: 'Save', cancel: 'Cancel' },
  books: { count: '{count, plural, one {# book} other {# books}}' },
}

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createCatalogFixture(targetCatalogs, currentCatalogs = new Map()) {
  const directory = await mkdtemp(path.join(tmpdir(), 'bookorbit-crowdin-sync-'))
  temporaryDirectories.push(directory)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'en.json'), `${JSON.stringify({ common: { save: 'Save' } }, null, 2)}\n`)
  await Promise.all(
    targetCatalogs.map(({ locale }) =>
      writeFile(path.join(directory, `${locale}.json`), `${JSON.stringify(currentCatalogs.get(locale) ?? {}, null, 2)}\n`),
    ),
  )
  return directory
}

function createSynchronizationFetch({ identifiers = ['common.save'], catalogs = new Map(), onDownload = async () => {} } = {}) {
  return vi.fn(async (input, init = {}) => {
    const url = new URL(input)
    if (url.hostname === 'api.crowdin.com' && url.pathname.endsWith('/files')) {
      return new Response(JSON.stringify({ data: [{ data: { id: 7, path: '/client/src/locales/en.json' } }] }))
    }
    if (url.hostname === 'api.crowdin.com' && url.pathname.endsWith('/strings')) {
      return new Response(JSON.stringify({ data: identifiers.map((identifier) => ({ data: { identifier } })) }))
    }
    if (url.hostname === 'api.crowdin.com' && url.pathname.includes('/translations/builds/files/')) {
      const { targetLanguageId } = JSON.parse(init.body)
      return new Response(JSON.stringify({ data: { url: `https://downloads.example.test/${encodeURIComponent(targetLanguageId)}.json` } }))
    }
    if (url.hostname === 'downloads.example.test') {
      const languageId = decodeURIComponent(path.basename(url.pathname, '.json'))
      await onDownload(languageId)
      return new Response(JSON.stringify(catalogs.get(languageId) ?? { common: { save: `Translated ${languageId}` } }))
    }
    throw new Error(`Unexpected request ${url.href}`)
  })
}

describe('Crowdin translation synchronization', () => {
  it('removes empty untranslated messages and follows English key order', () => {
    const exported = {
      books: { count: '' },
      common: { cancel: 'Zrušit', save: 'Uložit' },
    }

    expect(normalizeCrowdinCatalog(exported, reference)).toEqual({
      common: { save: 'Uložit', cancel: 'Zrušit' },
    })
  })

  it('rejects keys that do not exist in English', () => {
    expect(() => normalizeCrowdinCatalog({ common: { unknown: 'Neznámé' } }, reference)).toThrow('Crowdin export contains unknown key common.unknown')
  })

  it('detects when Crowdin has not synchronized the current English keys', () => {
    expect(sourceDrift(new Map([['common.save', 'Save']]), new Set(['common.cancel']))).toEqual({
      missing: ['common.save'],
      unexpected: ['common.cancel'],
    })
  })

  it('protects real translations in complete legacy catalogs without treating English fallbacks as translations', () => {
    const referenceMessages = new Map([
      ['common.save', 'Save'],
      ['common.cancel', 'Cancel'],
    ])
    const current = new Map([
      ['common.save', 'Uložit'],
      ['common.cancel', 'Cancel'],
    ])
    const exported = new Map()

    expect(findTranslationLosses({ locale: 'cs', reference: referenceMessages, current, exported })).toEqual([
      { locale: 'cs', key: 'common.save', reason: 'missing from Crowdin export' },
    ])
  })

  it('protects every existing key after a target catalog becomes sparse', () => {
    const referenceMessages = new Map([
      ['common.save', 'Save'],
      ['common.cancel', 'Cancel'],
    ])
    const current = new Map([['common.save', 'Save']])

    expect(findTranslationLosses({ locale: 'cs', reference: referenceMessages, current, exported: new Map() })).toEqual([
      { locale: 'cs', key: 'common.save', reason: 'missing from Crowdin export' },
    ])
  })

  it('rejects translations that Crowdin replaces with English source text', () => {
    const referenceMessages = new Map([['common.save', 'Save']])
    const current = new Map([['common.save', 'Uložit']])
    const exported = new Map([['common.save', 'Save']])

    expect(findTranslationLosses({ locale: 'cs', reference: referenceMessages, current, exported })).toEqual([
      { locale: 'cs', key: 'common.save', reason: 'replaced by English source text' },
    ])
  })

  it('requires exact acknowledgements for intentional translation losses', () => {
    const referenceMessages = new Map([['common.save', 'Save']])
    const currentCatalogs = new Map(TARGET_CATALOGS.map(({ locale }) => [locale, new Map()]))
    const exportedCatalogs = new Map(TARGET_CATALOGS.map(({ locale }) => [locale, new Map()]))
    currentCatalogs.set('cs', new Map([['common.save', 'Uložit']]))

    expect(() => assertTranslationRetention({ reference: referenceMessages, currentCatalogs, exportedCatalogs })).toThrow(
      'cs:common.save - missing from Crowdin export',
    )
    expect(() =>
      assertTranslationRetention({
        reference: referenceMessages,
        currentCatalogs,
        exportedCatalogs,
        allowedLosses: parseAllowedTranslationLosses('cs:common.save'),
      }),
    ).not.toThrow()
    expect(() =>
      assertTranslationRetention({
        reference: referenceMessages,
        currentCatalogs,
        exportedCatalogs,
        allowedLosses: parseAllowedTranslationLosses('de:common.save'),
      }),
    ).toThrow('de:common.save - acknowledgement does not match an exported loss')
  })

  it('rejects malformed and duplicate loss acknowledgements', () => {
    expect(() => parseAllowedTranslationLosses('xx:common.save')).toThrow('expected locale:message.key')
    expect(() => parseAllowedTranslationLosses('cs:common.save,cs:common.save')).toThrow('Duplicate translation loss acknowledgement')
  })

  it('requests untranslated-string omission and downloads the bounded export', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { url: 'https://downloads.example.test/cs.json' } }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ common: { save: 'Uložit' } })))
    const client = createCrowdinClient({ token: 'secret', projectId: '42', fetchImpl })

    await expect(client.exportedCatalog(7, 'cs')).resolves.toEqual({ common: { save: 'Uložit' } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.crowdin.com/api/v2/projects/42/translations/builds/files/7')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      targetLanguageId: 'cs',
      skipUntranslatedStrings: true,
    })
  })

  it('rejects non-HTTPS export URLs returned by Crowdin', () => {
    expect(() => assertSafeDownloadUrl('http://127.0.0.1/catalog.json')).toThrow('Crowdin export URL must use HTTPS')
  })

  it.each([
    'https://127.0.0.1/catalog.json',
    'https://127.0.0.1./catalog.json',
    'https://10.0.0.5/catalog.json',
    'https://2130706433/catalog.json',
    'https://[::1]/catalog.json',
    'https://[::ffff:127.0.0.1]/catalog.json',
    'https://[fd00::1]/catalog.json',
    'https://[fe90::1]/catalog.json',
    'https://localhost./catalog.json',
  ])('rejects private or local export URL %s', (url) => {
    expect(() => assertSafeDownloadUrl(url)).toThrow('Crowdin export URL must not target a local network host')
  })

  it.each(['https://fdn.example.com/x.json', 'https://fc-cdn.example.com/x.json'])(
    'allows public hostnames that begin with IPv6-looking prefixes: %s',
    (url) => {
      expect(assertSafeDownloadUrl(url).href).toBe(url)
    },
  )

  it('allows an IPv4-mapped public address', () => {
    expect(assertSafeDownloadUrl('https://[::ffff:8.8.8.8]/x.json').hostname).toBe('[::ffff:808:808]')
  })

  it('revalidates redirects before following them', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { url: 'https://downloads.example.test/cs.json' } })))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/catalog.json' } }))
    const client = createCrowdinClient({ token: 'secret', projectId: '42', fetchImpl })

    await expect(client.exportedCatalog(7, 'cs')).rejects.toThrow('Crowdin export URL must not target a local network host')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('keeps every Crowdin target list synchronized with the shared locale list', async () => {
    await expect(assertCrowdinTargetConfiguration()).resolves.toBeUndefined()
    const targetPaths = TARGET_CATALOGS.map(({ locale }) => `client/src/locales/${locale}.json`)
    expect(() =>
      validateCrowdinTargetConfiguration({
        crowdinLanguageIds: TARGET_CATALOGS.map(({ languageId }) => languageId),
        workflowCatalogPaths: targetPaths,
        classifierCatalogPaths: targetPaths.slice(1),
      }),
    ).toThrow('Crowdin PR classifier allowed_paths must match the supported target locales')
  })

  it('resolves repository configuration independently of the working directory', async () => {
    const originalDirectory = process.cwd()
    try {
      process.chdir(tmpdir())
      await expect(assertCrowdinTargetConfiguration()).resolves.toBeUndefined()
    } finally {
      process.chdir(originalDirectory)
    }
  })

  it('synchronizes catalogs with at most four concurrent language downloads', async () => {
    const targetCatalogs = TARGET_CATALOGS.slice(0, 6)
    const catalogDirectory = await createCatalogFixture(targetCatalogs)
    const outputDirectory = path.join(catalogDirectory, 'output')
    let activeDownloads = 0
    let maximumDownloads = 0
    const fetchImpl = createSynchronizationFetch({
      onDownload: async () => {
        activeDownloads += 1
        maximumDownloads = Math.max(maximumDownloads, activeDownloads)
        await new Promise((resolve) => setTimeout(resolve, 5))
        activeDownloads -= 1
      },
    })

    await syncCrowdinTranslations({
      token: 'secret',
      fetchImpl,
      catalogDirectory,
      outputDirectory,
      targetCatalogs,
      assertTargetConfiguration: async () => {},
    })

    expect(maximumDownloads).toBe(4)
    await expect(readFile(path.join(outputDirectory, 'cs.json'), 'utf8')).resolves.toContain('Translated cs')
  })

  it('rejects source drift before downloading or writing catalogs', async () => {
    const targetCatalogs = TARGET_CATALOGS.slice(0, 2)
    const catalogDirectory = await createCatalogFixture(targetCatalogs)
    const outputDirectory = path.join(catalogDirectory, 'output')
    const fetchImpl = createSynchronizationFetch({ identifiers: [] })

    await expect(
      syncCrowdinTranslations({
        token: 'secret',
        fetchImpl,
        catalogDirectory,
        outputDirectory,
        targetCatalogs,
        assertTargetConfiguration: async () => {},
      }),
    ).rejects.toThrow('Crowdin source is not synchronized with en.json')
    expect(fetchImpl.mock.calls.some(([input]) => new URL(input).hostname === 'downloads.example.test')).toBe(false)
    await expect(access(outputDirectory)).rejects.toThrow()
  })

  it('validates every downloaded catalog before writing any files', async () => {
    const targetCatalogs = TARGET_CATALOGS.slice(0, 2)
    const catalogDirectory = await createCatalogFixture(targetCatalogs)
    const outputDirectory = path.join(catalogDirectory, 'output')
    const catalogs = new Map([[targetCatalogs[0].languageId, { common: { save: 'Bad \u2014 value' } }]])

    await expect(
      syncCrowdinTranslations({
        token: 'secret',
        fetchImpl: createSynchronizationFetch({ catalogs }),
        catalogDirectory,
        outputDirectory,
        targetCatalogs,
        assertTargetConfiguration: async () => {},
      }),
    ).rejects.toThrow('Unicode em dash is not allowed')
    await expect(access(outputDirectory)).rejects.toThrow()
  })

  it('checks translation retention before writing any files', async () => {
    const targetCatalogs = TARGET_CATALOGS.slice(0, 2)
    const currentCatalogs = new Map([[targetCatalogs[0].locale, { common: { save: 'Ulozit' } }]])
    const catalogDirectory = await createCatalogFixture(targetCatalogs, currentCatalogs)
    const outputDirectory = path.join(catalogDirectory, 'output')
    const catalogs = new Map([[targetCatalogs[0].languageId, {}]])

    await expect(
      syncCrowdinTranslations({
        token: 'secret',
        fetchImpl: createSynchronizationFetch({ catalogs }),
        catalogDirectory,
        outputDirectory,
        targetCatalogs,
        assertTargetConfiguration: async () => {},
      }),
    ).rejects.toThrow('missing from Crowdin export')
    await expect(access(outputDirectory)).rejects.toThrow()
  })
})
