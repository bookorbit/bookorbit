import { readFile } from 'node:fs/promises'
import path from 'node:path'

const scriptDirectory = import.meta.dirname ?? path.join(process.cwd(), 'scripts')
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const localeTypesPath = path.join(repositoryRoot, 'packages/types/src/locale.ts')

export async function readSupportedLocales(sourcePath = localeTypesPath) {
  const source = await readFile(sourcePath, 'utf8')
  const match = source.match(/SUPPORTED_LOCALES\s*=\s*(\[[\s\S]*?\])\s+as const/)
  if (!match) throw new Error('Unable to read SUPPORTED_LOCALES from packages/types/src/locale.ts')
  return JSON.parse(match[1].replace(/,(\s*])$/, '$1'))
}

export const SUPPORTED_LOCALES = await readSupportedLocales()

const CROWDIN_LANGUAGE_ID_OVERRIDES = new Map([
  ['es', 'es-ES'],
  ['pt', 'pt-BR'],
  ['sv', 'sv-SE'],
  ['zh', 'zh-CN'],
])

for (const locale of CROWDIN_LANGUAGE_ID_OVERRIDES.keys()) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw new Error(`Crowdin language ID override references unsupported locale ${locale}`)
  }
}

export const TARGET_CATALOGS = SUPPORTED_LOCALES.filter((locale) => locale !== 'en').map((locale) => ({
  languageId: CROWDIN_LANGUAGE_ID_OVERRIDES.get(locale) ?? locale,
  locale,
}))

const expectedCatalogPaths = TARGET_CATALOGS.map(({ locale }) => `client/src/locales/${locale}.json`)

function parseCrowdinLanguageIds(source) {
  const match = source.match(/^export_languages:\s*\n((?:\s+-\s+[^\n]+\n?)+)/m)
  if (!match) throw new Error('Unable to read export_languages from crowdin.yml')
  return [...match[1].matchAll(/^\s+-\s+([^\s#]+)\s*$/gm)].map((entry) => entry[1])
}

function parseWorkflowCatalogPaths(source) {
  const match = source.match(/^\s+add-paths:\s*\|\s*\n((?:\s+client\/src\/locales\/[^\n]+\n?)+)/m)
  if (!match) throw new Error('Unable to read Crowdin add-paths from crowdin-translations.yml')
  return [...match[1].matchAll(/^\s+(client\/src\/locales\/[^\s]+)\s*$/gm)].map((entry) => entry[1])
}

function parseClassifierCatalogPaths(source) {
  const match = source.match(/allowed_paths=\(\s*([\s\S]*?)\s*\)/)
  if (!match) throw new Error('Unable to read allowed_paths from classify-crowdin-pr.sh')
  return [...match[1].matchAll(/"(client\/src\/locales\/[^"]+)"/g)].map((entry) => entry[1])
}

function assertExactList(label, actual, expected) {
  if (new Set(actual).size !== actual.length) throw new Error(`${label} contains duplicate entries`)
  if (JSON.stringify(actual) === JSON.stringify(expected)) return
  throw new Error(`${label} must match the supported target locales: expected ${expected.join(', ')}, found ${actual.join(', ')}`)
}

export function validateCrowdinTargetConfiguration({ crowdinLanguageIds, workflowCatalogPaths, classifierCatalogPaths }) {
  assertExactList(
    'crowdin.yml export_languages',
    crowdinLanguageIds,
    TARGET_CATALOGS.map(({ languageId }) => languageId),
  )
  assertExactList('Crowdin workflow add-paths', workflowCatalogPaths, expectedCatalogPaths)
  assertExactList('Crowdin PR classifier allowed_paths', classifierCatalogPaths, expectedCatalogPaths)
}

export async function assertCrowdinTargetConfiguration({
  crowdinConfigPath = path.join(repositoryRoot, 'crowdin.yml'),
  workflowPath = path.join(repositoryRoot, '.github/workflows/crowdin-translations.yml'),
  classifierPath = path.join(repositoryRoot, 'scripts/classify-crowdin-pr.sh'),
} = {}) {
  const [crowdinConfig, workflow, classifier] = await Promise.all([
    readFile(crowdinConfigPath, 'utf8'),
    readFile(workflowPath, 'utf8'),
    readFile(classifierPath, 'utf8'),
  ])
  validateCrowdinTargetConfiguration({
    crowdinLanguageIds: parseCrowdinLanguageIds(crowdinConfig),
    workflowCatalogPaths: parseWorkflowCatalogPaths(workflow),
    classifierCatalogPaths: parseClassifierCatalogPaths(classifier),
  })
}
