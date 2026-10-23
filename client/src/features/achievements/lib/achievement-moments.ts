import type { AchievementItem } from '@bookorbit/types'
import { formatDate, formatNumber } from '@/i18n/formatters'

/** A message key with its values, ready for `t()`. A value may itself be a message, resolved first. */
export interface MomentMessage {
  key: string
  values: Record<string, MomentValue>
}

export type MomentValue = string | number | MomentMessage

const M = 'achievements.moments.'
const R = 'achievements.records.'

type Context = Record<string, unknown>

function num(context: Context, key: string): number | null {
  const value = context[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function text(context: Context, key: string): string | null {
  const value = context[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function counted(key: string, count: number | null, extra: Record<string, MomentValue> = {}): MomentMessage | null {
  return count == null ? null : { key: M + key, values: { count: Math.round(count), ...extra } }
}

function monthName(year: number | null, month: number | null): string | null {
  if (year == null || month == null || month < 1 || month > 12) return null
  return formatDate(new Date(Date.UTC(year, month - 1, 1)), { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function timeOfDay(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : formatDate(date, { hour: 'numeric', minute: '2-digit' })
}

function dayOf(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : formatDate(date, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function duration(minutes: number | null): MomentMessage | null {
  if (minutes == null || minutes <= 0) return null
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return hours > 0
    ? { key: `${M}durationHours`, values: { hours: formatNumber(hours), minutes: formatNumber(rest) } }
    : { key: `${M}durationMinutes`, values: { minutes: formatNumber(rest) } }
}

function titled(key: string, context: Context, extra: Record<string, MomentValue> = {}): MomentMessage | null {
  const title = text(context, 'bookTitle')
  return title ? { key: M + key, values: { title, ...extra } } : null
}

// Each award stores the numbers behind it in `context`. These read only fields the evaluator writes, and
// return null when one is missing, so an older or newer award degrades to no sentence rather than a broken one.
const BY_SET: Record<string, (context: Context) => MomentMessage | null> = {
  books_finished: (c) => {
    const count = num(c, 'count')
    const title = text(c, 'bookTitle')
    return count != null && title ? { key: `${M}nthBook`, values: { number: formatNumber(count), title } } : null
  },
  pages_read: (c) => counted('pagesAtUnlock', num(c, 'totalPages')),
  hours_read: (c) => counted('hoursAtUnlock', num(c, 'totalHours')),
  long_book: (c) => {
    const pages = num(c, 'pageCount')
    return pages == null ? null : titled('titleWithPages', c, { count: pages })
  },
  library_builder: (c) => counted('booksAtUnlock', num(c, 'count')),
  annotator: (c) => counted('annotationsAtUnlock', num(c, 'count')),
  critic: (c) => counted('ratingsAtUnlock', num(c, 'count')),
  genre_explorer: (c) => counted('genresAtUnlock', num(c, 'genreCount')),
  polyglot: (c) => counted('languagesAtUnlock', num(c, 'languageCount')),
  streak: (c) => counted('streakAtUnlock', num(c, 'streak')),
}

const BY_KEY: Record<string, (context: Context) => MomentMessage | null> = {
  marathoner: (c) => {
    const span = duration(num(c, 'durationMinutes'))
    return span ? { key: `${M}longSession`, values: { duration: span } } : null
  },
  all_nighter: (c) => {
    const time = timeOfDay(text(c, 'startedAt'))
    return time ? { key: `${M}sessionStartedAt`, values: { time } } : null
  },
  early_bird: (c) => {
    const time = timeOfDay(text(c, 'startedAt'))
    return time ? { key: `${M}sessionStartedAt`, values: { time } } : null
  },
  sprint: (c) => titled('oneDayBook', c),
  binge_reader: (c) => counted('booksInWeek', num(c, 'count')),
  monthly_reader_2: (c) => {
    const month = monthName(num(c, 'year'), num(c, 'month'))
    return month ? counted('booksInMonth', num(c, 'count'), { month }) : null
  },
  yearly_finisher_12: (c) => {
    const year = num(c, 'year')
    return year == null ? null : counted('booksInYear', num(c, 'count'), { year: String(year) })
  },
  one_sitting: () => ({ key: `${M}wholeBookOneSession`, values: {} }),
  power_hour: (c) => counted('pagesInSession', num(c, 'pages')),
  speed_reader: (c) => counted('pagesInDay', num(c, 'pages')),
  slow_burn: (c) => {
    const days = num(c, 'days')
    return days == null ? null : titled('slowBurn', c, { count: days })
  },
  multi_format: (c) => counted('formatsOwned', num(c, 'formatCount')),
  note_keeper: (c) => counted('annotationsWithNote', num(c, 'count')),
  deep_dive_session: (c) => counted('annotationsInDay', num(c, 'count')),
  across_the_board: () => ({ key: `${M}everyStar`, values: {} }),
  box_of_crayons: () => ({ key: `${M}everyColour`, values: {} }),
  new_release: (c) => {
    const year = num(c, 'publishedYear')
    return year == null ? null : titled('titlePublished', c, { year: String(year) })
  },
  old_soul: (c) => {
    const year = num(c, 'publishedYear')
    return year == null ? null : titled('titlePublished', c, { year: String(year) })
  },
  genre_devotee: (c) => counted('booksInGenre', num(c, 'booksInGenre')),
  first_series: (c) => {
    const series = text(c, 'seriesName')
    return series ? titled('firstInSeries', c, { series }) : null
  },
  century_span: (c) => counted('centuries', num(c, 'centuryCount')),
  author_deep_dive: (c) => counted('booksBySameAuthor', num(c, 'booksRead')),
  decade_sampler: (c) => counted('decades', num(c, 'decadeCount')),
  short_story_fan: (c) => counted('shortBooks', num(c, 'count')),
  seasonal_reader: (c) => {
    const year = num(c, 'year')
    return year == null ? null : { key: `${M}allSeasons`, values: { year: String(year) } }
  },
  consistent_reader: (c) => counted('consistentDays', num(c, 'days')),
  weekend_rhythm: (c) => counted('weekendsInRow', num(c, 'weeks')),
  weekend_warrior: (c) => {
    const date = dayOf(text(c, 'weekend'))
    return date ? counted('weekendHours', num(c, 'hours'), { date }) : null
  },
  category_sweeper: (c) => counted('categoriesCovered', num(c, 'categoryCount')),
  full_orbit: (c) => counted('readingSources', num(c, 'sources')),
  two_worlds: (c) => counted('oneBookSources', num(c, 'maxSources')),
}

/** One sentence about the moment an achievement unlocked, from the context the server stored with it. */
export function momentOf(item: AchievementItem): MomentMessage | null {
  if (!item.earned || !item.context || typeof item.context !== 'object') return null
  const build = BY_KEY[item.key] ?? (item.groupKey ? BY_SET[item.groupKey] : undefined)
  return build ? build(item.context) : null
}

export function momentBookId(item: AchievementItem): number | null {
  if (typeof item.contextBookId === 'number') return item.contextBookId
  const id = item.context?.['bookId']
  return typeof id === 'number' ? id : null
}

export interface RecordEntry {
  item: AchievementItem
  /** The headline value as a message, so a duration can carry its own units. */
  value: MomentMessage
  label: MomentMessage
}

const RECORDS: Record<string, (context: Context) => { value: MomentMessage; label: MomentMessage } | null> = {
  marathoner: (c) => {
    const span = duration(num(c, 'durationMinutes'))
    return span ? { value: span, label: { key: `${R}oneSession`, values: {} } } : null
  },
  power_hour: (c) => plain(num(c, 'pages'), 'pagesInSession'),
  speed_reader: (c) => plain(num(c, 'pages'), 'pagesInDay'),
  binge_reader: (c) => plain(num(c, 'count'), 'booksInWeek'),
  monthly_reader_2: (c) => {
    const month = monthName(num(c, 'year'), num(c, 'month'))
    const value = plain(num(c, 'count'), 'booksInMonth')
    return month && value ? { ...value, label: { key: `${R}booksInMonth`, values: { month } } } : null
  },
  yearly_finisher_12: (c) => {
    const year = num(c, 'year')
    const value = plain(num(c, 'count'), 'booksInYear')
    return year != null && value ? { ...value, label: { key: `${R}booksInYear`, values: { year: String(year) } } } : null
  },
  annotator: (c) => plain(num(c, 'count'), 'annotations'),
  genre_explorer: (c) => plain(num(c, 'genreCount'), 'genresFinished'),
  streak: (c) => plain(num(c, 'streak'), 'daysInRow'),
  library_builder: (c) => plain(num(c, 'count'), 'booksInLibrary'),
}

function plain(count: number | null, label: string): { value: MomentMessage; label: MomentMessage } | null {
  return count == null ? null : { value: { key: `${R}value`, values: { value: formatNumber(count) } }, label: { key: R + label, values: {} } }
}

/**
 * The headline numbers behind the rarest earned medals, as they stood when each unlocked. One entry per
 * tier set (its highest earned tier), rarest first.
 */
export function recordBook(items: AchievementItem[], limit = 5): RecordEntry[] {
  const rank = { common: 0, rare: 1, epic: 2, legendary: 3 } as Record<string, number>
  const best = new Map<string, AchievementItem>()
  for (const item of items) {
    if (!item.earned || !item.context) continue
    const builder = RECORDS[item.key] ?? (item.groupKey ? RECORDS[item.groupKey] : undefined)
    if (!builder) continue
    const slot = item.groupKey ?? item.key
    const current = best.get(slot)
    if (!current || (item.tier ?? 0) > (current.tier ?? 0)) best.set(slot, item)
  }
  return [...best.values()]
    .map((item) => {
      const builder = RECORDS[item.key] ?? RECORDS[item.groupKey ?? '']!
      const entry = builder(item.context as Context)
      return entry ? { item, ...entry } : null
    })
    .filter((entry): entry is RecordEntry => entry !== null)
    .sort((a, b) => (rank[b.item.rarity] ?? 0) - (rank[a.item.rarity] ?? 0) || a.item.sortOrder - b.item.sortOrder)
    .slice(0, limit)
}
