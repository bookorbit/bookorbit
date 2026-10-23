import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useRegexMetadataEditor } from '../useRegexMetadataEditor'

vi.mock('@/lib/api', () => ({ api: vi.fn<typeof import('@/lib/api').api>() }))

describe('useRegexMetadataEditor', () => {
  const scopes: ReturnType<typeof effectScope>[] = []
  afterEach(() => {
    scopes.splice(0).forEach((scope) => scope.stop())
    vi.useRealTimers()
    vi.resetAllMocks()
  })
  function editor(config = { rules: [{ pattern: '(?<title>.+)$', flags: '' }] }) {
    const scope = effectScope()
    scopes.push(scope)
    return scope.run(() => useRegexMetadataEditor(config, 42))!
  }

  it('edits an isolated draft and preserves the ordering on apply', () => {
    const config = { rules: [{ pattern: '(?<title>.+)$', flags: '' }] }
    const state = editor(config)
    state.rules.value[0]!.pattern = '(?<series>.+)'
    state.addRule()
    state.rules.value[1]!.pattern = '(?<title>.+)'
    state.moveUp(1)
    expect(config.rules[0]!.pattern).toBe('(?<title>.+)$')
    expect(state.value()?.rules.map((rule) => rule.pattern)).toEqual(['(?<title>.+)', '(?<series>.+)'])
    state.enabled.value = false
    expect(state.value()).toBeNull()
  })

  it('sends the unchanged pattern and example path with its extension', async () => {
    const state = editor()
    state.relativePath.value = 'Author/My.Book.epub'
    vi.mocked(api).mockResolvedValue(
      new Response(
        JSON.stringify({
          inputPath: 'Author/My.Book',
          matched: true,
          ruleIndex: 0,
          metadata: { title: 'Author/My.Book' },
          groups: {},
          diagnostics: [],
        }),
      ),
    )
    await state.preview()
    const request = vi.mocked(api).mock.calls[0]!
    expect(request[0]).toBe('/api/v1/libraries/regex-metadata/preview')
    expect(JSON.parse(request[1]!.body as string)).toEqual({
      config: { rules: [{ pattern: '(?<title>.+)$', flags: '' }] },
      relativePath: 'Author/My.Book.epub',
      libraryId: 42,
    })
    expect(state.result.value?.inputPath).toBe('Author/My.Book')
  })

  it('ignores an old response after the input changes', async () => {
    const state = editor()
    state.relativePath.value = 'Old.epub'
    let resolve!: (response: Response) => void
    vi.mocked(api).mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const pending = state.preview()
    state.relativePath.value = 'New.epub'
    resolve(new Response(JSON.stringify({ matched: true, inputPath: 'Old' })))
    await pending
    expect(state.result.value).toBeNull()
    expect(state.busy.value).toBe(false)
  })

  it('shows failed requests and clears them when the draft changes', async () => {
    const state = editor()
    state.relativePath.value = '../outside.epub'
    vi.mocked(api).mockResolvedValue(new Response('', { status: 400 }))
    await state.preview()
    expect(state.error.value).toBe(true)
    state.relativePath.value = 'Inside.epub'
    expect(state.error.value).toBe(false)
  })
  it('debounces validation and only allows applying the current validated rules', async () => {
    vi.useFakeTimers()
    vi.mocked(api).mockResolvedValue(new Response(JSON.stringify({ valid: true, diagnostics: [] })))
    const state = editor()
    expect(state.canApply.value).toBe(false)
    await vi.advanceTimersByTimeAsync(399)
    expect(api).not.toHaveBeenCalled()
    state.rules.value[0]!.pattern = '(?<author>.+)'
    await vi.advanceTimersByTimeAsync(400)
    expect(api).toHaveBeenCalledTimes(1)
    expect(JSON.parse(vi.mocked(api).mock.calls[0]![1]!.body as string)).toEqual({
      config: { rules: [{ pattern: '(?<author>.+)', flags: '' }] },
      libraryId: 42,
    })
    expect(state.canApply.value).toBe(true)
    state.relativePath.value = 'No match.epub'
    expect(state.canApply.value).toBe(true)
    state.rules.value[0]!.pattern = '['
    expect(state.canApply.value).toBe(false)
    state.enabled.value = false
    expect(state.canApply.value).toBe(true)
    await vi.advanceTimersByTimeAsync(400)
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('ignores stale validation and remaps errors after rules are reordered', async () => {
    vi.useFakeTimers()
    let resolve!: (response: Response) => void
    vi.mocked(api).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const state = editor({
      rules: [
        { pattern: '[', flags: '' },
        { pattern: '(?<title>.+)', flags: '' },
      ],
    })
    await vi.advanceTimersByTimeAsync(400)
    state.moveDown(0)
    resolve(new Response(JSON.stringify({ valid: true, diagnostics: [] })))
    await Promise.resolve()
    expect(state.canApply.value).toBe(false)
    vi.mocked(api).mockResolvedValueOnce(new Response(JSON.stringify({ valid: false, diagnostics: [{ code: 'invalid_pattern', ruleIndex: 1 }] })))
    await vi.advanceTimersByTimeAsync(400)
    expect(state.ruleErrors.value).toEqual([[], ['invalid_pattern']])
    expect(state.canApply.value).toBe(false)
    state.removeRule(1)
    expect(state.ruleErrors.value).toEqual([[]])
    expect(state.canApply.value).toBe(false)
  })

  it('reports local bounds without sending requests and allows retry after network and worker failures', async () => {
    vi.useFakeTimers()
    const state = editor({ rules: [{ pattern: '', flags: 'gg' }] })
    await vi.advanceTimersByTimeAsync(400)
    expect(api).not.toHaveBeenCalled()
    expect(state.ruleErrors.value[0]).toEqual(['pattern_required', 'invalid_flags'])
    state.rules.value = [{ pattern: '(?<title>.+)', flags: '' }]
    vi.mocked(api).mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(400)
    expect(state.validationError.value).toBe(true)
    expect(state.canApply.value).toBe(false)
    vi.mocked(api).mockResolvedValueOnce(new Response(JSON.stringify({ valid: false, diagnostics: [{ code: 'worker_failed' }] })))
    await state.validateRules()
    expect(state.generalDiagnostics.value).toEqual([{ code: 'worker_failed' }])
    expect(state.canApply.value).toBe(false)
    vi.mocked(api).mockResolvedValueOnce(new Response(JSON.stringify({ valid: true, diagnostics: [] })))
    await state.validateRules()
    expect(state.canApply.value).toBe(true)
  })
})
