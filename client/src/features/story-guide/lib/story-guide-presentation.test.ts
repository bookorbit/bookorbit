import { describe, expect, it } from 'vitest'
import type { StoryGuideInfo, StoryGuideJob, StoryGuideStatus } from '@bookorbit/types'

import { isStoryGuideBuilding, isStoryGuideChecking, storyGuidePresentation } from './story-guide-presentation'

const GUIDE: StoryGuideInfo = {
  builtAt: '2026-11-09T18:20:00.000Z',
  models: { careful: { connectionId: 1, model: 'gpt-6.1-terra' }, fast: { connectionId: 1, model: 'gpt-6-luna' } },
  coverage: 1,
  format: 1,
  outdated: false,
  modelsChanged: false,
}

function status(overrides: Partial<StoryGuideStatus> = {}): StoryGuideStatus {
  return {
    fileId: 812,
    textKey: 'a'.repeat(64),
    canManage: true,
    build: { allowed: true },
    guide: null,
    job: null,
    estimate: { words: 98_000, minutes: 6, cost: 0.1 },
    ...overrides,
  }
}

function job(overrides: Partial<StoryGuideJob>): StoryGuideJob {
  return { kind: 'build', state: 'running', phase: 'lines', ...overrides }
}

function present(value: StoryGuideStatus | null, options: { managesSettings?: boolean; stillTheCase?: boolean } = {}) {
  return storyGuidePresentation({ status: value, ...options })
}

describe('storyGuidePresentation', () => {
  it('shows nothing without a status, and nothing to someone who cannot manage guides', () => {
    expect(present(null)).toEqual({ rows: [], menu: [], builtNote: null })
    const reader = status({ canManage: false, build: { allowed: false }, guide: { ...GUIDE, models: undefined }, job: job({ state: 'running' }) })
    expect(present(reader)).toEqual({ rows: [], menu: [], builtNote: null })
  })

  it('offers the build card and Build in the menu when nothing is built and building is allowed', () => {
    const result = present(status())
    expect(result.rows).toEqual([{ kind: 'buildCard', estimate: { words: 98_000, minutes: 6, cost: 0.1 } }])
    expect(result.menu).toEqual(['build'])
    expect(result.builtNote).toBeNull()
  })

  it('shows "Checking this book" while the server has not read the file, with no menu', () => {
    const result = present(status({ build: { allowed: false, reason: 'checking' }, estimate: undefined }))
    expect(result.rows).toEqual([{ kind: 'checking' }])
    expect(result.menu).toEqual([])
  })

  it('shows nothing at all for a book with no file a guide reads', () => {
    expect(present(status({ build: { allowed: false, reason: 'no-text-file' }, estimate: undefined }))).toEqual({
      rows: [],
      menu: [],
      builtNote: null,
    })
  })

  it('names the book language and the supported ones for a book in another language, with no actions', () => {
    const result = present(status({ build: { allowed: false, reason: 'language', language: 'pt', languages: ['en', 'es'] }, estimate: undefined }))
    expect(result).toEqual({
      rows: [
        {
          kind: 'notice',
          title: 'storyGuide',
          notice: { kind: 'language', language: 'pt', languages: ['en', 'es'] },
          actions: [],
          settingsHint: false,
          stillTheCase: false,
        },
      ],
      menu: [],
      builtNote: null,
    })
    const older = present(status({ build: { allowed: false, reason: 'language' }, estimate: undefined }), { managesSettings: true })
    expect(older.rows[0]).toMatchObject({ notice: { kind: 'language', language: null, languages: [] }, settingsHint: false })
  })

  it.each([
    ['too-short', { kind: 'tooShort' }, false],
    ['too-large', { kind: 'tooLarge' }, false],
    ['unreadable', { kind: 'unreadable' }, false],
    ['off', { kind: 'turnedOff' }, true],
    ['something-new', { kind: 'couldNotBuild' }, false],
  ] as const)('explains a book that cannot be built (%s), with no actions', (reason, notice, fixable) => {
    const value = status({ build: { allowed: false, reason: reason as 'too-short' }, estimate: undefined })
    expect(present(value).rows).toEqual([{ kind: 'notice', title: 'storyGuide', notice, actions: [], settingsHint: false, stillTheCase: false }])
    expect(present(value).menu).toEqual([])
    expect(present(value, { managesSettings: true }).rows[0]).toMatchObject({ settingsHint: fixable })
  })

  it("carries the server's word limit for a book that is too long", () => {
    const value = status({ build: { allowed: false, reason: 'too-long', limit: 250_000 }, estimate: undefined })
    expect(present(value, { managesSettings: true }).rows).toEqual([
      { kind: 'notice', title: 'storyGuide', notice: { kind: 'tooLong', limit: 250_000 }, actions: [], settingsHint: true, stillTheCase: false },
    ])
  })

  it('shows a queued build with the books ahead and Cancel build', () => {
    const result = present(status({ job: job({ state: 'queued', phase: null, position: 3 }) }))
    expect(result.rows).toEqual([{ kind: 'waiting', title: 'storyGuide', ahead: 2 }])
    expect(result.menu).toEqual(['cancelBuild'])
  })

  it('leaves out the books ahead when the build is next', () => {
    expect(present(status({ job: job({ state: 'queued', phase: null, position: 1 }) })).rows).toEqual([
      { kind: 'waiting', title: 'storyGuide', ahead: null },
    ])
  })

  it('shows a running build with its phase, progress and time left', () => {
    const result = present(status({ job: job({ state: 'running', phase: 'lines', done: 11, total: 34, minutesLeft: 3 }) }))
    expect(result.rows).toEqual([
      { kind: 'progress', title: 'storyGuide', phase: { kind: 'writing', chapter: 12, total: 34 }, fraction: 11 / 34, minutesLeft: 3 },
    ])
    expect(result.menu).toEqual(['cancelBuild'])
  })

  it.each([
    ['text', { kind: 'reading' }],
    ['names', { kind: 'findingNames' }],
    ['merge', { kind: 'findingNames' }],
    ['review', { kind: 'checkingWho' }],
    ['ties', { kind: 'findingTies' }],
    ['assemble', { kind: 'finishing' }],
    ['something-new', { kind: 'building' }],
    [null, { kind: 'building' }],
  ] as const)('names the %s phase', (phase, expected) => {
    expect(present(status({ job: job({ phase, done: 1, total: 4 }) })).rows[0]).toMatchObject({ phase: expected })
  })

  it('counts the chapters while summaries are written, and drops the numbers when the counts are missing', () => {
    expect(present(status({ job: job({ phase: 'summaries', done: 1, total: 4 }) })).rows[0]).toMatchObject({
      phase: { kind: 'summarizing', chapter: 2, total: 4 },
    })
    expect(present(status({ job: job({ phase: 'summaries' }) })).rows[0]).toMatchObject({
      phase: { kind: 'summarizing', chapter: null, total: null },
    })
  })

  it('writes descriptions without chapter numbers when the counts are missing, and shows no bar', () => {
    expect(present(status({ job: job({ phase: 'lines' }) })).rows[0]).toMatchObject({
      phase: { kind: 'writing', chapter: null, total: null },
      fraction: null,
      minutesLeft: null,
    })
  })

  it('treats a job state this version does not know as still building', () => {
    const value = status({ job: job({ state: 'resuming' as StoryGuideJob['state'], phase: 'ties' }) })
    expect(present(value).rows[0]).toMatchObject({ kind: 'progress' })
    expect(present(value).menu).toEqual(['cancelBuild'])
    expect(isStoryGuideBuilding(value)).toBe(true)
  })

  it.each([
    ['budget', 'pausedBudget', true],
    ['provider-auth', 'pausedProviderAuth', true],
    ['provider-down', 'pausedProviderDown', false],
    ['model-missing', 'pausedModelMissing', true],
    ['slot-empty', 'pausedSlotEmpty', true],
    ['off', 'pausedOff', true],
  ] as const)('explains a build paused for %s, with Try again', (reason, notice, fixable) => {
    const value = status({ job: job({ state: 'paused', reason }) })
    expect(present(value).rows).toEqual([
      { kind: 'notice', title: 'storyGuide', notice: { kind: notice }, actions: ['retry'], settingsHint: false, stillTheCase: false },
    ])
    expect(present(value).menu).toEqual(['retry', 'cancelBuild'])
    expect(present(value, { managesSettings: true }).rows[0]).toMatchObject({ settingsHint: fixable })
  })

  it('offers Continue and Cancel build for a build costing more than estimated', () => {
    const value = status({ job: job({ state: 'paused', reason: 'over-estimate' }) })
    expect(present(value).rows).toEqual([
      {
        kind: 'notice',
        title: 'storyGuide',
        notice: { kind: 'pausedOverEstimate' },
        actions: ['keepBuilding', 'cancelBuild'],
        settingsHint: false,
        stillTheCase: false,
      },
    ])
    expect(present(value).menu).toEqual(['keepBuilding', 'cancelBuild'])
  })

  it("offers Resume and Cancel build for someone's pause from the AI area", () => {
    const value = status({ job: job({ state: 'paused', reason: 'user' }) })
    expect(present(value, { managesSettings: true }).rows).toEqual([
      {
        kind: 'notice',
        title: 'storyGuide',
        notice: { kind: 'pausedUser' },
        actions: ['resume', 'cancelBuild'],
        settingsHint: false,
        stillTheCase: false,
      },
    ])
    expect(present(value).menu).toEqual(['resume', 'cancelBuild'])
  })

  it('reads a paused reason it does not know as a failure, and says when Try again found the same cause', () => {
    const value = status({ job: job({ state: 'paused', reason: 'something-new' }) })
    expect(present(value, { stillTheCase: true }).rows).toEqual([
      { kind: 'notice', title: 'storyGuide', notice: { kind: 'couldNotBuild' }, actions: ['retry'], settingsHint: false, stillTheCase: true },
    ])
  })

  it.each([
    ['low-coverage', 'lowCoverage', true],
    ['requester', 'requester', false],
    ['source-changed', 'sourceChanged', false],
    ['unreadable', 'unreadable', false],
    ['error', 'couldNotBuild', false],
    ['something-new', 'couldNotBuild', false],
    [null, 'couldNotBuild', false],
  ] as const)('explains a build that failed for %s, with Try again and Dismiss', (reason, notice, fixable) => {
    const value = status({ job: job({ state: 'failed', reason }) })
    expect(present(value).rows).toEqual([
      { kind: 'notice', title: 'storyGuide', notice: { kind: notice }, actions: ['retry', 'dismiss'], settingsHint: false, stillTheCase: false },
    ])
    expect(present(value).menu).toEqual(['retry', 'dismiss'])
    expect(present(value, { managesSettings: true }).rows[0]).toMatchObject({ settingsHint: fixable })
  })

  it('offers Rebuild and Delete for a built guide, and notes when and with which models it was built', () => {
    const result = present(status({ guide: GUIDE }))
    expect(result.rows).toEqual([])
    expect(result.menu).toEqual(['rebuild', 'delete'])
    expect(result.builtNote).toEqual({ builtAt: new Date('2026-11-09T18:20:00.000Z'), models: ['gpt-6-luna', 'gpt-6.1-terra'], coverage: 1 })
  })

  it('names a model once when both slots used it', () => {
    const models = { fast: { connectionId: 1, model: 'gpt-6-luna' }, careful: { connectionId: 2, model: 'gpt-6-luna' } }
    expect(present(status({ guide: { ...GUIDE, models } })).builtNote?.models).toEqual(['gpt-6-luna'])
  })

  it.each([
    ['outdated', { outdated: true }],
    ['built with other models', { modelsChanged: true }],
  ])('offers Update for a guide that is %s', (_label, change) => {
    const result = present(status({ guide: { ...GUIDE, ...change }, updateEstimate: { minutes: 2, cost: 0.03 } }))
    expect(result.rows).toEqual([{ kind: 'update' }])
    expect(result.menu).toEqual(['update', 'rebuild', 'delete'])
  })

  it('offers only Delete for a guide when building is not allowed', () => {
    const result = present(status({ guide: { ...GUIDE, outdated: true }, build: { allowed: false, reason: 'off' }, estimate: undefined }))
    expect(result.rows).toEqual([])
    expect(result.menu).toEqual(['delete'])
  })

  it.each([
    ['rebuild', 'rebuilding'],
    ['update', 'updating'],
  ] as const)('titles a %s beside the guide in use, which stays deletable', (kind, title) => {
    const queued = present(status({ guide: GUIDE, job: job({ kind, state: 'queued', phase: null, position: 1 }) }))
    expect(queued.rows).toEqual([{ kind: 'waiting', title, ahead: null }])
    expect(queued.menu).toEqual(['cancelBuild', 'delete'])
    const running = present(status({ guide: GUIDE, job: job({ kind, state: 'running', phase: 'ties', done: 1, total: 2, minutesLeft: 1 }) }))
    expect(running.rows[0]).toMatchObject({ kind: 'progress', title })
    expect(running.builtNote).not.toBeNull()
    const failed = present(status({ guide: GUIDE, job: job({ kind, state: 'failed', reason: 'error' }) }))
    expect(failed.rows[0]).toMatchObject({ kind: 'notice', title })
    expect(failed.menu).toEqual(['retry', 'dismiss', 'delete'])
  })
})

describe('isStoryGuideBuilding and isStoryGuideChecking', () => {
  it('polls only while a job is queued or running', () => {
    expect(isStoryGuideBuilding(null)).toBe(false)
    expect(isStoryGuideBuilding(status())).toBe(false)
    expect(isStoryGuideBuilding(status({ job: job({ state: 'queued' }) }))).toBe(true)
    expect(isStoryGuideBuilding(status({ job: job({ state: 'running' }) }))).toBe(true)
    expect(isStoryGuideBuilding(status({ job: job({ state: 'paused' }) }))).toBe(false)
    expect(isStoryGuideBuilding(status({ job: job({ state: 'failed' }) }))).toBe(false)
  })

  it('checks again only while the file has not been read and nothing else is known', () => {
    expect(isStoryGuideChecking(status({ build: { allowed: false, reason: 'checking' } }))).toBe(true)
    expect(isStoryGuideChecking(status({ build: { allowed: false, reason: 'too-short' } }))).toBe(false)
    expect(isStoryGuideChecking(status({ build: { allowed: false, reason: 'checking' }, guide: GUIDE }))).toBe(false)
  })
})
