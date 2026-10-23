import type { AchievementHint, AchievementHintResumeTarget } from '@bookorbit/types'
import type { RouteLocationRaw } from 'vue-router'
import { formatDate, formatLanguageName, formatListParts, formatNumber, formatPercent } from '@/i18n/formatters'
import type { DisplayItem } from '../types'
import type { MomentMessage } from './achievement-moments'

const H = 'achievements.hints.'
const HINT_BOOK_LIMIT = 3

export interface HintBook {
  id: number
  title: string | null
}

export interface HintAction {
  label: MomentMessage
  to: RouteLocationRaw
}

export interface HintView {
  /** The sentence that says how. */
  text: MomentMessage
  /** A quieter second sentence: a pace estimate, how many are already started. */
  note: MomentMessage | null
  books: HintBook[]
  action: HintAction | null
  /** Nothing can earn it right now, and `text` says why. */
  blocked: boolean
}

type Values = Record<string, unknown>

function num(values: Values, key: string): number | null {
  const value = values[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function text(values: Values, key: string): string | null {
  const value = values[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function message(key: string, values: MomentMessage['values'] = {}): MomentMessage {
  return { key: H + key, values }
}

function counted(key: string, count: number, extra: MomentMessage['values'] = {}): MomentMessage {
  return message(key, { count, ...extra })
}

function booksOf(hint: AchievementHint): HintBook[] {
  const ids = Array.isArray(hint.bookIds) ? hint.bookIds : []
  const titles = Array.isArray(hint.bookTitles) ? hint.bookTitles : []
  return ids
    .slice(0, HINT_BOOK_LIMIT)
    .map((id, index) => {
      const title = titles[index]
      return { id, title: typeof title === 'string' && title.trim() ? title : null }
    })
    .filter((book) => Number.isInteger(book.id) && book.id > 0)
}

/** "November and December", in the locale's own words. */
function sentenceList(values: string[]): string {
  return formatListParts(values)
    .map((part) => part.value)
    .join('')
}

function monthName(year: number, month: number): string {
  return formatDate(new Date(Date.UTC(year, month - 1, 1)), { month: 'long', timeZone: 'UTC' })
}

/** "About 18 days", "About 3 weeks", "About 4 months": the coarsest unit that still reads as a plan. */
function eta(days: number): MomentMessage {
  if (days < 14) return counted('etaDays', Math.max(1, Math.round(days)))
  if (days < 60) return counted('etaWeeks', Math.round(days / 7))
  return counted('etaMonths', Math.round(days / 30))
}

function resumeAction(value: unknown): HintAction | null {
  const target = value as Partial<AchievementHintResumeTarget> | null
  if (!target || !Number.isInteger(target.bookId) || !Number.isInteger(target.fileId)) return null
  return {
    label: message('continueReading'),
    to: { name: 'reader', params: { bookId: target.bookId!, fileId: target.fileId! }, query: { format: target.format ?? 'epub' } },
  }
}

function view(text: MomentMessage, hint: AchievementHint, extra: Partial<Omit<HintView, 'text'>> = {}): HintView {
  return { text, note: null, books: booksOf(hint), action: null, blocked: false, ...extra }
}

function unavailable(values: Values): MomentMessage | null {
  switch (values.reason) {
    case 'no_long_book': {
      const pages = num(values, 'pages')
      return pages == null ? null : message('noLongBook', { pages: formatNumber(pages) })
    }
    case 'nothing_before_year': {
      const year = num(values, 'year')
      return year == null ? null : message('nothingBeforeYear', { year: String(year) })
    }
    case 'too_few_periods': {
      const reachable = num(values, 'reachable')
      if (reachable == null) return null
      return counted(values.years === 100 ? 'tooFewCenturies' : 'tooFewDecades', reachable)
    }
    case 'missed_month': {
      const year = num(values, 'year')
      const month = num(values, 'month')
      if (year == null || month == null || month < 1 || month > 12) return null
      return message('missedMonth', { month: monthName(year, month), year: String(year) })
    }
    default:
      return null
  }
}

/**
 * What a hint says and offers. Null for a kind this client does not know, or one missing a value it
 * needs, so a newer server degrades to no hint rather than a broken sentence.
 */
export function hintView(hint: AchievementHint | null | undefined): HintView | null {
  if (!hint || typeof hint !== 'object') return null
  const values: Values = hint.values && typeof hint.values === 'object' ? (hint.values as Values) : {}
  const count = typeof hint.count === 'number' && Number.isFinite(hint.count) ? hint.count : null

  switch (hint.kind) {
    case 'reading_pace': {
      const hours = num(values, 'hours')
      const days = num(values, 'days')
      const etaDays = num(values, 'etaDays')
      if (hours == null || days == null) return null
      return view(counted('readingPace', hours, { days: formatNumber(days) }), hint, { note: etaDays == null ? null : eta(etaDays) })
    }
    case 'period_unread': {
      const period = num(values, 'period')
      if (period == null || count == null) return null
      const century = values.years === 100
      return view(counted(century ? 'centuryUnread' : 'decadeUnread', count, { [century ? 'century' : 'decade']: String(period) }), hint)
    }
    case 'stalled_book': {
      const startedAt = text(values, 'startedAt')
      const started = startedAt ? new Date(startedAt) : null
      if (!started || Number.isNaN(started.getTime())) return null
      const title = text(values, 'title') ?? message('untitledBook')
      const date = formatDate(started, { month: 'short', day: 'numeric', year: 'numeric' })
      const percent = num(values, 'percent')
      const sentence =
        percent == null ? message('stalledNoProgress', { title, date }) : message('stalled', { title, date, percent: formatPercent(percent / 100) })
      return view(sentence, hint, { action: resumeAction(values.resume) })
    }
    case 'nearly_finished': {
      const minPercent = num(values, 'minPercent')
      if (minPercent == null || count == null) return null
      return view(counted('nearlyFinished', count, { percent: formatPercent(minPercent / 100) }), hint, { action: resumeAction(values.resume) })
    }
    case 'unrated_finished': {
      if (count == null) return null
      const books = booksOf(hint)
      const first = books[0]
      return view(counted('unratedFinished', count), hint, {
        action: first ? { label: message('rateFinished'), to: `/book/${first.id}` } : null,
      })
    }
    case 'short_books': {
      const pages = num(values, 'maxPages')
      const started = num(values, 'inProgress')
      if (pages == null || count == null) return null
      return view(counted('shortBooks', count, { pages: formatNumber(pages) }), hint, {
        note: started ? counted('alreadyStarted', started) : null,
      })
    }
    case 'long_books': {
      const pages = num(values, 'minPages')
      if (pages == null || count == null) return null
      return view(counted('longBooks', count, { pages: formatNumber(pages) }), hint)
    }
    case 'old_books': {
      const year = num(values, 'year')
      if (year == null || count == null) return null
      return view(counted('oldBooks', count, { year: String(year) }), hint)
    }
    case 'author_unread': {
      const author = text(values, 'author')
      const authorId = num(values, 'authorId')
      const finished = num(values, 'finished')
      if (!author || authorId == null || finished == null || count == null) return null
      return view(counted('authorUnread', count, { author, finished }), hint, {
        action: { label: message('viewAuthor'), to: `/authors/${authorId}` },
      })
    }
    case 'language_unread': {
      const language = text(values, 'language')
      if (!language || count == null) return null
      return view(counted('languageUnread', count, { language: formatLanguageName(language) }), hint)
    }
    case 'months_left': {
      const year = num(values, 'year')
      const monthsRead = num(values, 'monthsRead')
      const months = Array.isArray(values.months)
        ? values.months.filter((month): month is number => Number.isInteger(month) && month >= 1 && month <= 12)
        : []
      if (year == null || monthsRead == null || months.length === 0) return null
      return view(counted('monthsRead', monthsRead, { year: String(year) }), hint, {
        note: counted('monthsLeft', months.length, { months: sentenceList(months.map((month) => monthName(year, month))) }),
      })
    }
    case 'unavailable': {
      const reason = unavailable(values)
      return reason ? { text: reason, note: null, books: [], action: null, blocked: true } : null
    }
    default:
      return null
  }
}

/** The achievement a display item's hint is keyed by: the tier that unlocks next, or a locked single. */
export function hintKeyOf(item: DisplayItem): string | null {
  if (item.type === 'tiered') return item.nextUnearned?.key ?? null
  return item.achievement.earned ? null : item.achievement.key
}
