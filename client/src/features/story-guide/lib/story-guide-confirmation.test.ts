import { describe, expect, it } from 'vitest'
import type { StoryGuideStatus } from '@bookorbit/types'

import { storyGuideConfirmation } from './story-guide-confirmation'

const GUIDE = { builtAt: '2026-11-09T18:20:00.000Z', coverage: 1, format: 1, outdated: true, modelsChanged: false }

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

function choices(confirmation: ReturnType<typeof storyGuideConfirmation>) {
  return confirmation?.choices.map(({ label, variant, action, fixes }) => ({ label, variant, action, fixes }))
}

describe('storyGuideConfirmation', () => {
  it('asks before a build, with the time and, for admins, the cost', () => {
    const confirmation = storyGuideConfirmation('build', status())
    expect(confirmation).toMatchObject({
      title: 'Build a story guide?',
      message: "Your server's AI reads the whole book once. Everyone who reads this book can use it.",
      estimate: 'About 6 minutes and $0.10.',
      destructive: false,
    })
    expect(choices(confirmation)).toEqual([
      { label: 'Cancel', variant: 'outline', action: undefined, fixes: undefined },
      { label: 'Build', variant: 'default', action: 'build', fixes: undefined },
    ])
  })

  it('ends at the time for managers who do not see costs, and when the models have no prices', () => {
    expect(storyGuideConfirmation('build', status({ estimate: { minutes: 6 } }))?.estimate).toBe('About 6 minutes.')
    expect(storyGuideConfirmation('build', status({ estimate: { minutes: 6, cost: null } }))?.estimate).toBe('About 6 minutes.')
  })

  it('asks before an update with the update estimate', () => {
    const confirmation = storyGuideConfirmation('update', status({ guide: GUIDE, updateEstimate: { minutes: 2, cost: 0.03 } }))
    expect(confirmation).toMatchObject({
      title: 'Update the story guide?',
      message: 'Only the parts improved since it was built are redone.',
      estimate: 'About 2 minutes and $0.03.',
    })
    expect(choices(confirmation)?.map((choice) => choice.label)).toEqual(['Cancel', 'Update'])
  })

  it('asks before a rebuild, saying fixes made for everyone are kept', () => {
    const confirmation = storyGuideConfirmation('rebuild', status({ guide: GUIDE }))
    expect(confirmation).toMatchObject({
      title: 'Rebuild the story guide from scratch?',
      message: 'Replaces the guide for everyone who reads this book. Fixes made for everyone are kept.',
      estimate: 'About 6 minutes and $0.10.',
      destructive: false,
    })
    expect(choices(confirmation)?.map((choice) => choice.label)).toEqual(['Cancel', 'Rebuild'])
  })

  it('asks before a delete whether fixes made for everyone go too', () => {
    const confirmation = storyGuideConfirmation('delete', status({ guide: GUIDE }))
    expect(confirmation).toMatchObject({
      title: 'Delete the story guide?',
      message: 'Everyone who reads this book loses it.',
      estimate: null,
      destructive: true,
    })
    expect(choices(confirmation)).toEqual([
      { label: 'Cancel', variant: 'outline', action: undefined, fixes: undefined },
      { label: 'Delete guide, keep fixes', variant: 'destructive', action: 'delete', fixes: 'keep' },
      { label: 'Delete guide and fixes', variant: 'destructive-outline', action: 'delete', fixes: 'delete' },
    ])
  })

  it('says a delete stops the build in progress, but not a failed one', () => {
    const running = status({ guide: GUIDE, job: { kind: 'rebuild', state: 'running', phase: 'ties' } })
    expect(storyGuideConfirmation('delete', running)?.message).toBe('Everyone who reads this book loses it. The build in progress stops too.')
    const failed = status({ guide: GUIDE, job: { kind: 'rebuild', state: 'failed', reason: 'error' } })
    expect(storyGuideConfirmation('delete', failed)?.message).toBe('Everyone who reads this book loses it.')
  })

  it('asks before cancelling a build, keeping its work for next time', () => {
    const confirmation = storyGuideConfirmation('cancelBuild', status({ job: { kind: 'build', state: 'queued', position: 2 } }))
    expect(confirmation).toMatchObject({ title: 'Cancel the build?', message: 'Work done so far is kept for next time.', destructive: true })
    expect(choices(confirmation)).toEqual([
      { label: 'Keep building', variant: 'outline', action: undefined, fixes: undefined },
      { label: 'Cancel build', variant: 'destructive', action: 'cancelBuild', fixes: undefined },
    ])
  })

  it('says the current guide stays when cancelling a rebuild', () => {
    const confirmation = storyGuideConfirmation('cancelBuild', status({ guide: GUIDE, job: { kind: 'rebuild', state: 'running', phase: 'lines' } }))
    expect(confirmation?.message).toBe('The current guide stays.')
  })

  it('asks before continuing an over-estimate build, in dollars for admins', () => {
    const paused = status({ job: { kind: 'build', state: 'paused', reason: 'over-estimate' } })
    const confirmation = storyGuideConfirmation('keepBuilding', paused)
    expect(confirmation).toMatchObject({
      title: 'Keep building?',
      message: 'This build has cost $0.30, three times the estimate. It can cost up to $0.30 more before it asks again.',
      destructive: false,
    })
    expect(choices(confirmation)).toEqual([
      { label: 'Cancel build', variant: 'destructive', action: 'cancelBuild', fixes: undefined },
      { label: 'Continue', variant: 'default', action: 'keepBuilding', fixes: undefined },
    ])
  })

  it('words Continue without dollars for managers who do not see costs', () => {
    const paused = status({ job: { kind: 'build', state: 'paused', reason: 'over-estimate' }, estimate: { minutes: 6 } })
    expect(storyGuideConfirmation('keepBuilding', paused)?.message).toBe(
      'This build is using much more of the AI budget than expected. It can use as much again before it asks.',
    )
  })

  it('asks nothing before Try again or Dismiss', () => {
    expect(storyGuideConfirmation('retry', status())).toBeNull()
    expect(storyGuideConfirmation('dismiss', status())).toBeNull()
  })
})
