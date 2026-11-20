import type { AiJobModels, StoryGuideEstimate, StoryGuideJob, StoryGuideStatus } from '@bookorbit/types'

/** Something a manager can do to a book's guide, from the card's menu or a row's own button. */
export type StoryGuideAction =
  | 'build'
  | 'update'
  | 'rebuild'
  /** Try again on a paused or failed job. */
  | 'retry'
  /** Past an `over-estimate` pause: the same route as Try again. */
  | 'keepBuilding'
  /** After a person's pause: the same route as Try again. */
  | 'resume'
  | 'cancelBuild'
  /** Clears a failed job: the cancel route. */
  | 'dismiss'
  | 'delete'

export const DESTRUCTIVE_STORY_GUIDE_ACTIONS: ReadonlySet<StoryGuideAction> = new Set(['cancelBuild', 'delete'])

/** Why a book cannot be built, or why its job stopped: one sentence each. */
export type StoryGuideNotice =
  | {
      kind:
        | 'pausedBudget'
        | 'pausedOverEstimate'
        | 'pausedProviderAuth'
        | 'pausedProviderDown'
        | 'pausedModelMissing'
        | 'pausedSlotEmpty'
        | 'pausedOff'
        /** Someone paused it in the AI area. */
        | 'pausedUser'
        /** No guide and no job, with the feature off. */
        | 'turnedOff'
        | 'tooLarge'
        | 'tooShort'
        | 'unreadable'
        | 'lowCoverage'
        | 'requester'
        | 'sourceChanged'
        /** `error`, and any reason this version does not know. */
        | 'couldNotBuild'
    }
  | { kind: 'tooLong'; limit: number | null }
  /** The book's language, when the server knows it, and the languages guides are built in; empty from a server that does not say. */
  | { kind: 'language'; language: string | null; languages: string[] }

/** Whose build a row is about: a book's first, or a new one beside the guide in use. */
export type StoryGuideProgressTitle = 'storyGuide' | 'updating' | 'rebuilding'

/** The step a running build is on, as the copy deck names it. */
export type StoryGuidePhase =
  | { kind: 'reading' | 'findingNames' | 'checkingWho' | 'findingTies' | 'finishing' | 'building' }
  | { kind: 'writing' | 'summarizing'; chapter: number | null; total: number | null }

export type StoryGuideRow =
  /** No guide and no job, building allowed. */
  | { kind: 'buildCard'; estimate: StoryGuideEstimate | null }
  /** The server has not read the file yet. */
  | { kind: 'checking' }
  /** Why a book cannot be built or a job stopped, with the actions that fix it. */
  | {
      kind: 'notice'
      title: StoryGuideProgressTitle
      notice: StoryGuideNotice
      actions: StoryGuideAction[]
      settingsHint: boolean
      stillTheCase: boolean
    }
  /** A queued job; `ahead` only when someone is ahead. */
  | { kind: 'waiting'; title: StoryGuideProgressTitle; ahead: number | null }
  | { kind: 'progress'; title: StoryGuideProgressTitle; phase: StoryGuidePhase; fraction: number | null; minutesLeft: number | null }
  /** An outdated guide, or one built with models the slots no longer use. */
  | { kind: 'update' }

/** When the guide in use was built, with which models, and how much of the book it covers (0 to 1). */
export interface StoryGuideBuiltNote {
  builtAt: Date | null
  models: string[]
  coverage: number | null
}

/** Everything the book page shows from a status, derived in one place. */
export interface StoryGuidePresentation {
  rows: StoryGuideRow[]
  /** The card's menu, in order. Empty: no menu. */
  menu: StoryGuideAction[]
  builtNote: StoryGuideBuiltNote | null
}

/** Reasons a job waits on. Anything else on a paused job reads as a failure's sentence. */
const PAUSED_NOTICES: Record<string, StoryGuideNotice['kind']> = {
  budget: 'pausedBudget',
  'over-estimate': 'pausedOverEstimate',
  'provider-auth': 'pausedProviderAuth',
  'provider-down': 'pausedProviderDown',
  'model-missing': 'pausedModelMissing',
  'slot-empty': 'pausedSlotEmpty',
  off: 'pausedOff',
  user: 'pausedUser',
}

const FAILED_NOTICES: Record<string, StoryGuideNotice['kind']> = {
  'low-coverage': 'lowCoverage',
  requester: 'requester',
  'source-changed': 'sourceChanged',
  unreadable: 'unreadable',
}

const REFUSAL_NOTICES: Record<string, StoryGuideNotice['kind']> = {
  off: 'turnedOff',
  'too-large': 'tooLarge',
  'too-short': 'tooShort',
  unreadable: 'unreadable',
}

/** Causes an admin can change in the server's AI settings. */
const FIXABLE_IN_SETTINGS: ReadonlySet<StoryGuideNotice['kind']> = new Set([
  'pausedBudget',
  'pausedProviderAuth',
  'pausedModelMissing',
  'pausedSlotEmpty',
  'pausedOff',
  'turnedOff',
  'tooLong',
  'lowCoverage',
])

const OVER_ESTIMATE = 'over-estimate'
const USER_PAUSE = 'user'

function lookup(table: Record<string, StoryGuideNotice['kind']>, reason: string | null | undefined): StoryGuideNotice['kind'] | null {
  return reason && Object.hasOwn(table, reason) ? table[reason]! : null
}

function pausedNotice(reason: string | null | undefined): StoryGuideNotice {
  const kind = lookup(PAUSED_NOTICES, reason)
  return kind ? ({ kind } as StoryGuideNotice) : failedNotice(reason)
}

function failedNotice(reason: string | null | undefined): StoryGuideNotice {
  return { kind: lookup(FAILED_NOTICES, reason) ?? 'couldNotBuild' } as StoryGuideNotice
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function refusalNotice(reason: string, build: Extract<StoryGuideStatus['build'], { allowed: false }>): StoryGuideNotice {
  const limit = build.limit
  if (reason === 'too-long') return { kind: 'tooLong', limit: typeof limit === 'number' ? limit : null }
  if (reason === 'language') {
    return {
      kind: 'language',
      language: typeof build.language === 'string' && build.language ? build.language : null,
      languages: stringsOf(build.languages),
    }
  }
  return { kind: lookup(REFUSAL_NOTICES, reason) ?? 'couldNotBuild' } as StoryGuideNotice
}

function progressTitle(job: StoryGuideJob, hasGuide: boolean): StoryGuideProgressTitle {
  if (!hasGuide) return 'storyGuide'
  return job.kind === 'rebuild' ? 'rebuilding' : 'updating'
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A step that goes chapter by chapter, with the chapter it is on when the counts are known. */
function chapterPhase(kind: 'writing' | 'summarizing', job: Pick<StoryGuideJob, 'done' | 'total'>): StoryGuidePhase {
  const done = count(job.done)
  const total = count(job.total)
  if (done === null || total === null || total <= 0) return { kind, chapter: null, total: null }
  return { kind, chapter: Math.min(Math.max(done + 1, 1), total), total }
}

export function storyGuidePhase(job: Pick<StoryGuideJob, 'phase' | 'done' | 'total'>): StoryGuidePhase {
  switch (job.phase) {
    case 'text':
      return { kind: 'reading' }
    case 'names':
    case 'merge':
      return { kind: 'findingNames' }
    case 'review':
      return { kind: 'checkingWho' }
    case 'ties':
      return { kind: 'findingTies' }
    case 'lines':
    case 'profiles':
      return chapterPhase('writing', job)
    case 'summaries':
      return chapterPhase('summarizing', job)
    case 'assemble':
      return { kind: 'finishing' }
    default:
      return { kind: 'building' }
  }
}

export function storyGuideFraction(job: StoryGuideJob): number | null {
  const done = count(job.done)
  const total = count(job.total)
  if (done === null || total === null || total <= 0) return null
  return Math.min(1, Math.max(0, done / total))
}

/** The slots' models, fast first, each named once. */
function modelNames(models: AiJobModels | null | undefined): string[] {
  if (!models) return []
  const order = ['fast', 'careful']
  const slots = Object.keys(models).sort((a, b) => {
    const rank = (slot: string) => (order.includes(slot) ? order.indexOf(slot) : order.length)
    return rank(a) - rank(b) || a.localeCompare(b)
  })
  const names: string[] = []
  for (const slot of slots) {
    const name = models[slot as keyof AiJobModels]?.model
    if (typeof name === 'string' && name && !names.includes(name)) names.push(name)
  }
  return names
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export interface StoryGuidePresentationInput {
  status: StoryGuideStatus | null
  /** The account manages app settings: the AI settings hint under reasons it can fix there. */
  managesSettings?: boolean
  /** Try again just found the same cause still applies. */
  stillTheCase?: boolean
}

/**
 * What the book page shows for a status. Only people who can manage guides see anything: the page
 * shows no guide content, so a reader's status has nothing for it.
 */
export function storyGuidePresentation({
  status,
  managesSettings = false,
  stillTheCase = false,
}: StoryGuidePresentationInput): StoryGuidePresentation {
  if (!status?.canManage) return { rows: [], menu: [], builtNote: null }
  const rows: StoryGuideRow[] = []
  const menu: StoryGuideAction[] = []
  const guide = status.guide
  const job = status.job
  const allowed = status.build?.allowed === true

  const hint = (notice: StoryGuideNotice) => managesSettings && FIXABLE_IN_SETTINGS.has(notice.kind)

  if (job) {
    const title = progressTitle(job, guide !== null)
    switch (job.state) {
      case 'queued': {
        const position = count(job.position)
        const ahead = position !== null && position - 1 > 0 ? position - 1 : null
        rows.push({ kind: 'waiting', title, ahead })
        menu.push('cancelBuild')
        break
      }
      case 'paused': {
        const notice = pausedNotice(job.reason)
        const overEstimate = job.reason === OVER_ESTIMATE
        const userPause = job.reason === USER_PAUSE
        const proceed: StoryGuideAction = overEstimate ? 'keepBuilding' : userPause ? 'resume' : 'retry'
        rows.push({
          kind: 'notice',
          title,
          notice,
          actions: overEstimate || userPause ? [proceed, 'cancelBuild'] : ['retry'],
          settingsHint: hint(notice),
          stillTheCase,
        })
        menu.push(proceed, 'cancelBuild')
        break
      }
      case 'failed': {
        const notice = failedNotice(job.reason)
        rows.push({ kind: 'notice', title, notice, actions: ['retry', 'dismiss'], settingsHint: hint(notice), stillTheCase: false })
        menu.push('retry', 'dismiss')
        break
      }
      default:
        // Running, and any state this version does not know: still an unfinished job.
        rows.push({
          kind: 'progress',
          title,
          phase: storyGuidePhase(job),
          fraction: storyGuideFraction(job),
          minutesLeft: count(job.minutesLeft),
        })
        menu.push('cancelBuild')
    }
  } else if (!guide) {
    if (allowed) {
      rows.push({ kind: 'buildCard', estimate: status.estimate ?? null })
      menu.push('build')
    } else {
      const refusal = status.build && !status.build.allowed ? status.build : null
      const reason = refusal?.reason
      if (reason === 'checking') {
        rows.push({ kind: 'checking' })
      } else if (refusal && reason && reason !== 'no-text-file') {
        const notice = refusalNotice(reason, refusal)
        rows.push({ kind: 'notice', title: 'storyGuide', notice, actions: [], settingsHint: hint(notice), stillTheCase: false })
      }
    }
  } else if (allowed) {
    if (guide.outdated || guide.modelsChanged) {
      rows.push({ kind: 'update' })
      menu.push('update')
    }
    menu.push('rebuild')
  }

  const builtNote = guide
    ? {
        builtAt: parseDate(guide.builtAt),
        models: modelNames(guide.models),
        coverage: Number.isFinite(guide.coverage) ? guide.coverage : null,
      }
    : null
  if (guide) menu.push('delete')
  return { rows, menu, builtNote }
}

/** A status calls for polling while a job is queued or running. */
export function isStoryGuideBuilding(status: StoryGuideStatus | null): boolean {
  const state = status?.job?.state
  return state !== undefined && state !== 'paused' && state !== 'failed'
}

/** The server has not read the book's file yet; asking once more shortly finds out. */
export function isStoryGuideChecking(status: StoryGuideStatus | null): boolean {
  if (!status || status.job || status.guide) return false
  return status.build && !status.build.allowed && status.build.reason === 'checking'
}
