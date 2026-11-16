import { describe, expect, it } from 'vitest'

import {
  storyGuideActionLabel,
  storyGuideBuiltLine,
  storyGuideBuiltText,
  storyGuideEstimateLine,
  storyGuideEstimateSentence,
  storyGuideNoticeSentence,
  storyGuidePhaseText,
  storyGuideProgressTitle,
} from './story-guide-copy'
import type { StoryGuideAction, StoryGuideNotice } from './story-guide-presentation'

describe('story guide copy', () => {
  it('estimates time and dollars for admins, time alone for other managers and unpriced models', () => {
    expect(storyGuideEstimateLine({ minutes: 6, cost: 0.1 })).toBe('About 6 minutes and $0.10')
    expect(storyGuideEstimateLine({ minutes: 6 })).toBe('About 6 minutes')
    expect(storyGuideEstimateLine({ minutes: 6, cost: null })).toBe('About 6 minutes')
    expect(storyGuideEstimateLine({ minutes: 1, cost: 0.0153 })).toBe('About 1 minute and $0.02')
    expect(storyGuideEstimateLine({ minutes: 0 })).toBeNull()
    expect(storyGuideEstimateLine(null)).toBeNull()
  })

  it('shows the cost alone, with when the time appears, before a build on the models has finished', () => {
    expect(storyGuideEstimateLine({ minutes: null, cost: 0.1 })).toBe('About $0.10. The time shows after the first finished build.')
    expect(storyGuideEstimateLine({ minutes: null })).toBe('The time shows after the first finished build.')
    expect(storyGuideEstimateLine({ minutes: null, cost: null })).toBe('The time shows after the first finished build.')
    expect(storyGuideEstimateSentence({ minutes: null, cost: 0.1 })).toBe('About $0.10. The time shows after the first finished build.')
    expect(storyGuideEstimateSentence({ minutes: null })).toBeNull()
  })

  it('ends a confirmation with the estimate as its own sentence', () => {
    expect(storyGuideEstimateSentence({ minutes: 6, cost: 0.1 })).toBe('About 6 minutes and $0.10.')
    expect(storyGuideEstimateSentence({ minutes: 2 })).toBe('About 2 minutes.')
    expect(storyGuideEstimateSentence({ minutes: 1, cost: null })).toBe('About 1 minute.')
    expect(storyGuideEstimateSentence(undefined)).toBeNull()
  })

  it('labels every action as the menu shows it', () => {
    const labels: Record<StoryGuideAction, string> = {
      build: 'Build story guide',
      update: 'Update story guide',
      rebuild: 'Rebuild from scratch',
      retry: 'Try again',
      keepBuilding: 'Continue',
      resume: 'Resume',
      cancelBuild: 'Cancel build',
      dismiss: 'Dismiss',
      delete: 'Delete story guide',
    }
    for (const [action, label] of Object.entries(labels)) expect(storyGuideActionLabel(action as StoryGuideAction)).toBe(label)
  })

  it('titles a build by whose it is', () => {
    expect(storyGuideProgressTitle('storyGuide')).toBe('Story guide')
    expect(storyGuideProgressTitle('updating')).toBe('Updating the story guide')
    expect(storyGuideProgressTitle('rebuilding')).toBe('Rebuilding the story guide')
  })

  it('names each phase from the copy deck', () => {
    expect(storyGuidePhaseText({ kind: 'reading' })).toBe('Reading the book')
    expect(storyGuidePhaseText({ kind: 'findingNames' })).toBe('Finding names')
    expect(storyGuidePhaseText({ kind: 'checkingWho' })).toBe("Checking who's who")
    expect(storyGuidePhaseText({ kind: 'findingTies' })).toBe('Finding ties')
    expect(storyGuidePhaseText({ kind: 'writing', chapter: 12, total: 34 })).toBe('Writing descriptions, chapter 12 of 34')
    expect(storyGuidePhaseText({ kind: 'writing', chapter: null, total: null })).toBe('Writing descriptions')
    expect(storyGuidePhaseText({ kind: 'summarizing', chapter: 3, total: 34 })).toBe('Writing summaries, chapter 3 of 34')
    expect(storyGuidePhaseText({ kind: 'summarizing', chapter: null, total: null })).toBe('Writing summaries')
    expect(storyGuidePhaseText({ kind: 'finishing' })).toBe('Finishing up')
    expect(storyGuidePhaseText({ kind: 'building' })).toBe('Building')
  })

  it('says every reason in a sentence of its own', () => {
    const sentences: [StoryGuideNotice, string][] = [
      [{ kind: 'pausedBudget' }, "Paused: this month's AI budget is used up."],
      [{ kind: 'pausedOverEstimate' }, 'Paused: this build is costing more than expected.'],
      [{ kind: 'pausedProviderAuth' }, "Paused: the AI provider didn't accept the key."],
      [{ kind: 'pausedProviderDown' }, "Paused: the AI provider isn't responding. It'll keep trying."],
      [{ kind: 'pausedModelMissing' }, 'Paused: the AI model is no longer available.'],
      [{ kind: 'pausedSlotEmpty' }, 'Paused: no AI model is chosen for story guides.'],
      [{ kind: 'pausedOff' }, 'Paused: story guides were turned off on this server.'],
      [{ kind: 'pausedUser' }, 'Paused. It waits until someone resumes it.'],
      [{ kind: 'turnedOff' }, 'Story guides are turned off on this server.'],
      [{ kind: 'tooLarge' }, "This book's file is too large for a story guide."],
      [{ kind: 'tooLong', limit: 400_000 }, "This book is longer than this server's limit of 400,000 words."],
      [{ kind: 'tooLong', limit: null }, "This book is longer than this server's limit of 400,000 words."],
      [{ kind: 'tooShort' }, 'This book is too short for a story guide.'],
      [{ kind: 'unreadable' }, "This book's file couldn't be read."],
      [{ kind: 'lowCoverage' }, 'The AI provider refused too much of this book. A different model may work.'],
      [{ kind: 'requester' }, 'The person who started this build can no longer build story guides.'],
      [{ kind: 'sourceChanged' }, "This book's file changed during the build."],
      [{ kind: 'couldNotBuild' }, "The story guide couldn't be built."],
    ]
    for (const [notice, sentence] of sentences) expect(storyGuideNoticeSentence(notice)).toBe(sentence)
  })

  it('notes when and with which models a guide was built, adding the year for another year', () => {
    const now = new Date('2026-11-10T12:00:00Z')
    const builtAt = new Date('2026-11-09T12:00:00Z')
    const note = { builtAt, models: ['gpt-6-luna', 'gpt-6.1-terra'], coverage: 1 }
    expect(storyGuideBuiltText(note, now)).toBe('Built Nov 9 with gpt-6-luna and gpt-6.1-terra')
    expect(storyGuideBuiltText({ ...note, models: ['gpt-6-luna'] }, now)).toBe('Built Nov 9 with gpt-6-luna')
    expect(storyGuideBuiltText({ ...note, models: [] }, now)).toBe('Built Nov 9')
    expect(storyGuideBuiltText({ ...note, builtAt: new Date('2025-03-02T12:00:00Z'), models: [] }, now)).toBe('Built Mar 2, 2025')
    expect(storyGuideBuiltText({ ...note, builtAt: null }, now)).toBeNull()
  })

  it('states when a guide was built and how much of the book it covers', () => {
    const now = new Date('2026-11-10T12:00:00Z')
    const note = { builtAt: new Date('2026-11-09T12:00:00Z'), models: ['gpt-6-luna'], coverage: 1 }
    expect(storyGuideBuiltLine(note, now)).toBe('Built Nov 9 · whole book')
    expect(storyGuideBuiltLine({ ...note, coverage: 0.996 }, now)).toBe('Built Nov 9 · whole book')
    expect(storyGuideBuiltLine({ ...note, coverage: 0.92 }, now)).toBe('Built Nov 9 · 92% of the book')
    expect(storyGuideBuiltLine({ ...note, coverage: null }, now)).toBe('Built Nov 9')
    expect(storyGuideBuiltLine({ ...note, builtAt: new Date('2025-03-02T12:00:00Z') }, now)).toBe('Built Mar 2, 2025 · whole book')
    expect(storyGuideBuiltLine({ ...note, builtAt: null }, now)).toBeNull()
  })
})
