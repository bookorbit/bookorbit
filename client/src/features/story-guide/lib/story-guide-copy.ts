import type { StoryGuideEstimate } from '@bookorbit/types'

import { i18n } from '@/i18n'
import { formatDate, formatListParts, formatNumber } from '@/i18n/formatters'
import type { StoryGuideAction, StoryGuideBuiltNote, StoryGuideNotice, StoryGuidePhase, StoryGuideProgressTitle } from './story-guide-presentation'

const t = i18n.global.t

/** Dollars, as the server prices the AI slots. */
export function storyGuideDollars(dollars: number): string {
  return formatNumber(dollars, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** A cost the caller is shown: absent for managers without the settings permission, null when unpriced. */
function shownCost(estimate: StoryGuideEstimate): number | null {
  return typeof estimate.cost === 'number' ? estimate.cost : null
}

/** Learned minutes; null before a finished build has shown how fast the models are, or on nothing to run. */
function shownMinutes(estimate: StoryGuideEstimate): number | null {
  return typeof estimate.minutes === 'number' && estimate.minutes > 0 ? estimate.minutes : null
}

/** Beside the Build button: "About 6 minutes and $0.10", "About 6 minutes", or the cost alone until a build has finished. */
export function storyGuideEstimateLine(estimate: StoryGuideEstimate | null | undefined): string | null {
  if (!estimate || estimate.minutes === 0) return null
  const minutes = shownMinutes(estimate)
  const cost = shownCost(estimate)
  if (minutes === null) {
    return cost !== null
      ? t('book.detail.storyGuide.estimateCostNoTime', { cost: storyGuideDollars(cost) })
      : t('book.detail.storyGuide.estimateNoTime')
  }
  if (cost !== null) return t('book.detail.storyGuide.estimateWithCost', { count: minutes, cost: storyGuideDollars(cost) })
  return t('book.detail.storyGuide.estimate', { count: minutes })
}

/** Ending a confirmation: "About 6 minutes and $0.10.", "About 6 minutes.", or the cost alone until a build has finished. */
export function storyGuideEstimateSentence(estimate: StoryGuideEstimate | null | undefined): string | null {
  if (!estimate || estimate.minutes === 0) return null
  const minutes = shownMinutes(estimate)
  const cost = shownCost(estimate)
  if (minutes === null) {
    return cost !== null ? t('book.detail.storyGuide.confirm.estimateCostNoTime', { cost: storyGuideDollars(cost) }) : null
  }
  if (cost !== null) return t('book.detail.storyGuide.confirm.estimateWithCost', { count: minutes, cost: storyGuideDollars(cost) })
  return t('book.detail.storyGuide.confirm.estimate', { count: minutes })
}

export function storyGuideActionLabel(action: StoryGuideAction): string {
  switch (action) {
    case 'build':
      return t('book.detail.storyGuide.actions.build')
    case 'update':
      return t('book.detail.storyGuide.actions.update')
    case 'rebuild':
      return t('book.detail.storyGuide.actions.rebuild')
    case 'retry':
      return t('book.detail.storyGuide.actions.retry')
    case 'keepBuilding':
      return t('book.detail.storyGuide.actions.keepBuilding')
    case 'resume':
      return t('book.detail.storyGuide.actions.resume')
    case 'cancelBuild':
      return t('book.detail.storyGuide.actions.cancelBuild')
    case 'dismiss':
      return t('book.detail.storyGuide.actions.dismiss')
    case 'delete':
      return t('book.detail.storyGuide.actions.delete')
  }
}

export function storyGuideProgressTitle(title: StoryGuideProgressTitle): string {
  switch (title) {
    case 'storyGuide':
      return t('book.detail.storyGuide.title')
    case 'updating':
      return t('book.detail.storyGuide.updating')
    case 'rebuilding':
      return t('book.detail.storyGuide.rebuilding')
  }
}

export function storyGuidePhaseText(phase: StoryGuidePhase): string {
  switch (phase.kind) {
    case 'reading':
      return t('book.detail.storyGuide.phases.reading')
    case 'findingNames':
      return t('book.detail.storyGuide.phases.findingNames')
    case 'checkingWho':
      return t('book.detail.storyGuide.phases.checkingWho')
    case 'findingTies':
      return t('book.detail.storyGuide.phases.findingTies')
    case 'writing':
      return phase.chapter !== null && phase.total !== null
        ? t('book.detail.storyGuide.phases.writingChapter', { chapter: formatNumber(phase.chapter), total: formatNumber(phase.total) })
        : t('book.detail.storyGuide.phases.writing')
    case 'finishing':
      return t('book.detail.storyGuide.phases.finishing')
    case 'building':
      return t('book.detail.storyGuide.phases.building')
  }
}

/** The server's default longest-book setting, for a `too-long` that somehow came without its limit. */
const DEFAULT_WORD_LIMIT = 400_000

export function storyGuideNoticeSentence(notice: StoryGuideNotice): string {
  switch (notice.kind) {
    case 'pausedBudget':
      return t('book.detail.storyGuide.reasons.pausedBudget')
    case 'pausedOverEstimate':
      return t('book.detail.storyGuide.reasons.pausedOverEstimate')
    case 'pausedProviderAuth':
      return t('book.detail.storyGuide.reasons.pausedProviderAuth')
    case 'pausedProviderDown':
      return t('book.detail.storyGuide.reasons.pausedProviderDown')
    case 'pausedModelMissing':
      return t('book.detail.storyGuide.reasons.pausedModelMissing')
    case 'pausedSlotEmpty':
      return t('book.detail.storyGuide.reasons.pausedSlotEmpty')
    case 'pausedOff':
      return t('book.detail.storyGuide.reasons.pausedOff')
    case 'pausedUser':
      return t('book.detail.storyGuide.reasons.pausedUser')
    case 'turnedOff':
      return t('book.detail.storyGuide.reasons.turnedOff')
    case 'tooLarge':
      return t('book.detail.storyGuide.reasons.tooLarge')
    case 'tooLong':
      return t('book.detail.storyGuide.reasons.tooLong', { limit: formatNumber(notice.limit ?? DEFAULT_WORD_LIMIT) })
    case 'tooShort':
      return t('book.detail.storyGuide.reasons.tooShort')
    case 'unreadable':
      return t('book.detail.storyGuide.reasons.unreadable')
    case 'lowCoverage':
      return t('book.detail.storyGuide.reasons.lowCoverage')
    case 'requester':
      return t('book.detail.storyGuide.reasons.requester')
    case 'sourceChanged':
      return t('book.detail.storyGuide.reasons.sourceChanged')
    case 'couldNotBuild':
      return t('book.detail.storyGuide.reasons.couldNotBuild')
  }
}

function sameYear(date: Date, now: Date): boolean {
  return date.getFullYear() === now.getFullYear()
}

/** "Built Nov 9 with gpt-6-luna and gpt-6.1-terra"; null without a date. */
export function storyGuideBuiltText(note: StoryGuideBuiltNote, now: Date = new Date()): string | null {
  if (!note.builtAt) return null
  const date = formatDate(
    note.builtAt,
    sameYear(note.builtAt, now) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
  )
  if (note.models.length === 0) return t('book.detail.storyGuide.builtOn', { date })
  const models = formatListParts(note.models)
    .map((part) => part.value)
    .join('')
  return t('book.detail.storyGuide.builtWith', { date, models })
}
