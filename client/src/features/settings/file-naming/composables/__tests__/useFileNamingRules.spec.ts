import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { Library } from '@bookorbit/types'

const { apiMock, toastSuccess, toastError, fetchLibraries } = vi.hoisted(() => ({
  apiMock: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
  fetchLibraries: vi.fn<() => Promise<void>>(),
}))

// `ref` is not available inside vi.hoisted, but vi.mock factories run lazily, so the
// shared library list can live here and still be seen by the mocked composable.
const libraries = ref<Library[]>([])

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('vue-sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))
vi.mock('@/features/library/composables/useLibraries', () => ({ useLibraries: () => ({ libraries, fetchLibraries }) }))

import { i18n } from '@/i18n'
import { useFileNamingRules } from '../useFileNamingRules'
import type { NamingRule, NamingRuleId } from '../../lib/naming-rules'

type Rules = ReturnType<typeof useFileNamingRules>

function mountComposable(): Rules {
  let result!: Rules
  mount(
    {
      setup() {
        result = useFileNamingRules()
        return () => null
      },
    },
    { global: { plugins: [i18n] } },
  )
  return result
}

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return { id: 1, name: 'Novels', organizationMode: 'book_per_folder', fileNamingPattern: null, ...overrides } as Library
}

const ok = (body: object = {}): Response =>
  ({ ok: true, status: 200, json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body) }) as unknown as Response
const failed = (): Response => ({ ok: false, status: 500, json: vi.fn<() => Promise<unknown>>() }) as unknown as Response

const GLOBAL_PATTERNS: Record<string, string> = {
  '/api/v1/app-settings/upload-pattern': '{authors}/{title}',
  '/api/v1/app-settings/upload-pattern-folder': '{authors}/{title}/{title}',
  '/api/v1/app-settings/download-pattern': '{originalFilename}',
}

/** GETs answer from the table above; every write succeeds unless a test overrides it. */
function respondNormally() {
  apiMock.mockImplementation((input, init) => {
    const url = String(input)
    if (!init || init.method === undefined) {
      if (url in GLOBAL_PATTERNS) return Promise.resolve(ok({ pattern: GLOBAL_PATTERNS[url] }))
      if (url.includes('cross-platform')) return Promise.resolve(ok({ enabled: true }))
    }
    return Promise.resolve(ok())
  })
}

const ruleFor = (rules: Rules, id: NamingRuleId): NamingRule => rules.rules.value.find((rule) => rule.id === id)!

async function loaded(): Promise<Rules> {
  const rules = mountComposable()
  await rules.load()
  await flushPromises()
  return rules
}

beforeEach(() => {
  vi.clearAllMocks()
  i18n.global.locale.value = 'en'
  libraries.value = [makeLibrary()]
  fetchLibraries.mockResolvedValue(undefined)
  respondNormally()
})

describe('loading', () => {
  it('seeds every global rule from its own endpoint', async () => {
    const rules = await loaded()

    expect(rules.effectivePattern(ruleFor(rules, 'global:fileAsBook'))).toBe('{authors}/{title}')
    expect(rules.effectivePattern(ruleFor(rules, 'global:folderAsBook'))).toBe('{authors}/{title}/{title}')
    expect(rules.effectivePattern(ruleFor(rules, 'global:download'))).toBe('{originalFilename}')
  })

  it('leaves every rule clean right after loading', async () => {
    const rules = await loaded()

    expect(rules.dirtyRules.value).toHaveLength(0)
  })

  it('lists one rule per library alongside the three global defaults', async () => {
    libraries.value = [makeLibrary(), makeLibrary({ id: 2, name: 'Comics' })]
    const rules = await loaded()

    expect(rules.rules.value).toHaveLength(5)
  })
})

describe('inheritance', () => {
  it('resolves a library with no pattern to the global default for its mode', async () => {
    const rules = await loaded()

    expect(rules.isInherited(ruleFor(rules, 'library:1'))).toBe(true)
    expect(rules.effectivePattern(ruleFor(rules, 'library:1'))).toBe('{authors}/{title}/{title}')
  })

  it('resolves a library with its own pattern to that pattern', async () => {
    libraries.value = [makeLibrary({ fileNamingPattern: '{title}' })]
    const rules = await loaded()

    expect(rules.isInherited(ruleFor(rules, 'library:1'))).toBe(false)
    expect(rules.effectivePattern(ruleFor(rules, 'library:1'))).toBe('{title}')
  })

  it('follows the File as Book default for a book-per-file library', async () => {
    libraries.value = [makeLibrary({ organizationMode: 'book_per_file' })]
    const rules = await loaded()

    expect(rules.effectivePattern(ruleFor(rules, 'library:1'))).toBe('{authors}/{title}')
  })

  it('seeds a new override from whatever the library inherits, so nothing changes yet', async () => {
    const rules = await loaded()
    rules.addOverride(ruleFor(rules, 'library:1'))

    expect(rules.isInherited(ruleFor(rules, 'library:1'))).toBe(false)
    expect(rules.effectivePattern(ruleFor(rules, 'library:1'))).toBe('{authors}/{title}/{title}')
    expect(rules.isDirty(ruleFor(rules, 'library:1'))).toBe(true)
  })

  it('returns a library to inheriting when its override is removed', async () => {
    libraries.value = [makeLibrary({ fileNamingPattern: '{title}' })]
    const rules = await loaded()
    rules.removeOverride(ruleFor(rules, 'library:1'))

    expect(rules.isInherited(ruleFor(rules, 'library:1'))).toBe(true)
    expect(rules.isDirty(ruleFor(rules, 'library:1'))).toBe(true)
  })
})

describe('validation', () => {
  it('reports a pattern containing characters the resolver rejects', async () => {
    const rules = await loaded()
    rules.setDraft(ruleFor(rules, 'global:fileAsBook'), '{title}?')

    expect(rules.errorFor(ruleFor(rules, 'global:fileAsBook'))).toBe('Pattern contains invalid characters')
  })

  it('reports an optional group that was never closed', async () => {
    const rules = await loaded()
    rules.setDraft(ruleFor(rules, 'global:fileAsBook'), '<{series}/{title}')

    expect(rules.errorFor(ruleFor(rules, 'global:fileAsBook'))).toBe('An optional group is missing its closing angle bracket')
  })

  it('reports a token that was never closed', async () => {
    const rules = await loaded()
    rules.setDraft(ruleFor(rules, 'global:fileAsBook'), '{title')

    expect(rules.errorFor(ruleFor(rules, 'global:fileAsBook'))).toBe('A token is missing its closing brace')
  })

  it('blocks saving while any dirty rule is invalid', async () => {
    const rules = await loaded()
    rules.setDraft(ruleFor(rules, 'global:fileAsBook'), '{title}?')

    expect(rules.blockedByError.value).toBe(true)
  })

  it('strips a pasted newline rather than storing a multi-line pattern', async () => {
    const rules = await loaded()
    rules.setDraft(ruleFor(rules, 'global:fileAsBook'), '{authors}\n/{title}')

    expect(rules.effectivePattern(ruleFor(rules, 'global:fileAsBook'))).toBe('{authors}/{title}')
  })
})

describe('saving', () => {
  it('PUTs a changed global rule to its own endpoint', async () => {
    const rules = await loaded()
    rules.setDraft(ruleFor(rules, 'global:download'), '{title}')
    await rules.saveAll()
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/app-settings/download-pattern',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ pattern: '{title}' }) }),
    )
  })

  it('PATCHes a changed library rule onto the library', async () => {
    const rules = await loaded()
    rules.addOverride(ruleFor(rules, 'library:1'))
    rules.setDraft(ruleFor(rules, 'library:1'), '{title}')
    await rules.saveAll()
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/libraries/1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ fileNamingPattern: '{title}' }) }),
    )
  })

  it('sends null when an override is removed', async () => {
    libraries.value = [makeLibrary({ fileNamingPattern: '{title}' })]
    const rules = await loaded()
    rules.removeOverride(ruleFor(rules, 'library:1'))
    await rules.saveAll()
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/libraries/1', expect.objectContaining({ body: JSON.stringify({ fileNamingPattern: null }) }))
  })

  it('only writes the rules that actually changed', async () => {
    const rules = await loaded()
    rules.setDraft(ruleFor(rules, 'global:download'), '{title}')
    apiMock.mockClear()
    await rules.saveAll()
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('marks saved rules clean', async () => {
    const rules = await loaded()
    rules.setDraft(ruleFor(rules, 'global:download'), '{title}')
    await rules.saveAll()
    await flushPromises()

    expect(rules.dirtyRules.value).toHaveLength(0)
    expect(toastSuccess).toHaveBeenCalledWith('1 naming rule saved')
  })

  it('publishes a saved library pattern onto the shared library record', async () => {
    const rules = await loaded()
    rules.addOverride(ruleFor(rules, 'library:1'))
    rules.setDraft(ruleFor(rules, 'library:1'), '{title}')
    await rules.saveAll()
    await flushPromises()

    expect(libraries.value[0]!.fileNamingPattern).toBe('{title}')
  })

  it('leaves the shared library record untouched when the write fails', async () => {
    const rules = await loaded()
    rules.addOverride(ruleFor(rules, 'library:1'))
    rules.setDraft(ruleFor(rules, 'library:1'), '{title}')
    apiMock.mockResolvedValue(failed())
    await rules.saveAll()
    await flushPromises()

    expect(libraries.value[0]!.fileNamingPattern).toBeNull()
  })

  it('keeps a rule dirty when its write fails', async () => {
    const rules = await loaded()
    rules.setDraft(ruleFor(rules, 'global:download'), '{title}')
    apiMock.mockResolvedValue(failed())
    await rules.saveAll()
    await flushPromises()

    expect(rules.dirtyRules.value).toHaveLength(1)
    expect(toastError).toHaveBeenCalledWith('Failed to save 1 naming rule')
  })

  it('keeps only the failed rule dirty on a partial failure', async () => {
    const rules = await loaded()
    rules.setDraft(ruleFor(rules, 'global:download'), '{title}')
    rules.setDraft(ruleFor(rules, 'global:fileAsBook'), '{title}')
    apiMock.mockImplementation((input) => Promise.resolve(String(input).includes('download-pattern') ? failed() : ok()))
    await rules.saveAll()
    await flushPromises()

    expect(rules.dirtyRules.value.map((rule) => rule.id)).toEqual(['global:download'])
    expect(toastError).toHaveBeenCalledWith('Saved 1, failed 1. The rules that failed still have unsaved changes.')
  })

  it('survives a rejected request without leaving the page stuck in saving', async () => {
    const rules = await loaded()
    rules.setDraft(ruleFor(rules, 'global:download'), '{title}')
    apiMock.mockRejectedValue(new Error('network error'))
    await rules.saveAll()
    await flushPromises()

    expect(rules.saving.value).toBe(false)
    expect(rules.dirtyRules.value).toHaveLength(1)
  })

  it('refuses to save while a dirty rule is invalid', async () => {
    const rules = await loaded()
    rules.setDraft(ruleFor(rules, 'global:download'), '{title}?')
    apiMock.mockClear()
    await rules.saveAll()
    await flushPromises()

    expect(apiMock).not.toHaveBeenCalled()
  })

  it('restores every draft to its saved value on discard', async () => {
    const rules = await loaded()
    rules.setDraft(ruleFor(rules, 'global:download'), '{title}')
    rules.addOverride(ruleFor(rules, 'library:1'))
    rules.discardAll()

    expect(rules.dirtyRules.value).toHaveLength(0)
    expect(rules.isInherited(ruleFor(rules, 'library:1'))).toBe(true)
  })
})

describe('filtering', () => {
  it('narrows the rule list to names matching the query', async () => {
    libraries.value = [makeLibrary(), makeLibrary({ id: 2, name: 'Comics' })]
    const rules = await loaded()
    rules.query.value = 'comic'

    expect(rules.visibleRules.value.map((rule) => rule.id)).toEqual(['library:2'])
  })

  it('matches global rules by their translated name', async () => {
    const rules = await loaded()
    rules.query.value = 'download'

    expect(rules.visibleRules.value.map((rule) => rule.id)).toEqual(['global:download'])
  })
})

describe('cross-platform sanitization', () => {
  it('reads the stored value on load', async () => {
    apiMock.mockImplementation((input, init) => {
      const url = String(input)
      if (!init && url.includes('cross-platform')) return Promise.resolve(ok({ enabled: false }))
      if (!init && url in GLOBAL_PATTERNS) return Promise.resolve(ok({ pattern: GLOBAL_PATTERNS[url] }))
      return Promise.resolve(ok())
    })
    const rules = await loaded()

    expect(rules.crossPlatformSanitizationEnabled.value).toBe(false)
  })

  it('PUTs the new value and keeps it when the write succeeds', async () => {
    const rules = await loaded()
    await rules.setCrossPlatformSanitization(false)
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/app-settings/cross-platform-path-sanitization',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ enabled: false }) }),
    )
    expect(rules.crossPlatformSanitizationEnabled.value).toBe(false)
    expect(toastSuccess).toHaveBeenCalledWith('Cross-platform path sanitization disabled')
  })

  it('reverts the toggle when the write fails', async () => {
    const rules = await loaded()
    apiMock.mockResolvedValue(failed())
    await rules.setCrossPlatformSanitization(false)
    await flushPromises()

    expect(rules.crossPlatformSanitizationEnabled.value).toBe(true)
    expect(toastError).toHaveBeenCalledWith('Failed to save cross-platform path sanitization')
  })

  it('clears the saving flag after the request rejects', async () => {
    const rules = await loaded()
    apiMock.mockRejectedValue(new Error('network error'))
    await rules.setCrossPlatformSanitization(false).catch(() => undefined)
    await flushPromises()

    expect(rules.savingCrossPlatformSanitization.value).toBe(false)
  })
})
