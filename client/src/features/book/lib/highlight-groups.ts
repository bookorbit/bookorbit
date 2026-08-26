import type { AnnotationChapterStat, AnnotationItem, AnnotationStats } from '@bookorbit/types'

export type HighlightGroupMode = 'chapter' | 'colour' | 'day'

export const HIGHLIGHT_GROUP_MODES: HighlightGroupMode[] = ['chapter', 'colour', 'day']

export interface HighlightGroup {
  /** Stable key for `v-for` and for scroll targets. */
  key: string
  mode: HighlightGroupMode
  /** Chapter title, colour hex, or ISO day, depending on the mode. */
  label: string | null
  /** Chapter number to print beside the label, when the position resolved to one. */
  index: number | null
  /** Colour hex when grouping by colour, so the rule can carry a swatch. */
  colour: string | null
  /** Total across the whole book, from the server aggregate, not from the loaded page. */
  total: number
  /** Colour composition of the group, for the index bars. */
  colours: { color: string; count: number }[]
  /** The highlights loaded so far that belong to this group. */
  items: AnnotationItem[]
}

/** The day an annotation was made, in the viewer's own time zone. */
export function highlightDay(annotation: AnnotationItem): string {
  const date = new Date(annotation.createdAt)
  if (Number.isNaN(date.getTime())) return ''
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Map key for highlights that carry no chapter title. Exported so callers cannot invent their own. */
export const NO_CHAPTER_KEY = 'chapter:none'

function chapterKey(title: string | null): string {
  return title ?? NO_CHAPTER_KEY
}

/**
 * Builds the groups for the stream and the index from the server's aggregate, then hangs the
 * highlights loaded so far off them.
 *
 * The totals come from `stats`, never from `items`, because the stream loads a window at a time:
 * a chapter whose highlights are all further down the list must still appear in the index with
 * its real count, and the count must not creep upward as more pages arrive.
 */
export function buildHighlightGroups(items: AnnotationItem[], stats: AnnotationStats | null, mode: HighlightGroupMode): HighlightGroup[] {
  if (mode === 'colour') return buildColourGroups(items, stats)
  if (mode === 'day') return buildDayGroups(items)
  return buildChapterGroups(items, stats?.chapterBreakdown ?? [])
}

function buildChapterGroups(items: AnnotationItem[], breakdown: AnnotationChapterStat[]): HighlightGroup[] {
  const groups = new Map<string, HighlightGroup>()

  for (const chapter of breakdown) {
    groups.set(chapterKey(chapter.title), {
      key: chapterKey(chapter.title),
      mode: 'chapter',
      label: chapter.title,
      index: chapter.chapterIndex == null ? null : chapter.chapterIndex + 1,
      colour: null,
      total: chapter.count,
      colours: chapter.colors,
      items: [],
    })
  }

  // A chapter can be missing from the aggregate only if the two queries raced a write. Keep the
  // highlight visible rather than dropping it on the floor.
  for (const item of items) {
    const key = chapterKey(item.chapterTitle)
    let group = groups.get(key)
    if (!group) {
      group = { key, mode: 'chapter', label: item.chapterTitle, index: null, colour: null, total: 0, colours: [], items: [] }
      groups.set(key, group)
    }
    group.items.push(item)
    if (group.total === 0) group.total = group.items.length
  }

  return [...groups.values()]
}

function buildColourGroups(items: AnnotationItem[], stats: AnnotationStats | null): HighlightGroup[] {
  const groups = new Map<string, HighlightGroup>()

  for (const entry of stats?.colorBreakdown ?? []) {
    groups.set(entry.color, {
      key: entry.color,
      mode: 'colour',
      label: entry.color,
      index: null,
      colour: entry.color,
      total: entry.count,
      colours: [entry],
      items: [],
    })
  }

  for (const item of items) {
    let group = groups.get(item.color)
    if (!group) {
      group = { key: item.color, mode: 'colour', label: item.color, index: null, colour: item.color, total: 0, colours: [], items: [] }
      groups.set(item.color, group)
    }
    group.items.push(item)
    if (group.total === 0) group.total = group.items.length
  }

  return [...groups.values()]
}

/**
 * Days are grouped from the loaded highlights rather than from `stats.activity`, because the
 * server cuts its days in UTC while the stream renders timestamps in the viewer's zone. Taking
 * the aggregate would put a late-evening highlight under the wrong heading.
 */
function buildDayGroups(items: AnnotationItem[]): HighlightGroup[] {
  const groups = new Map<string, HighlightGroup>()

  for (const item of items) {
    const key = highlightDay(item)
    let group = groups.get(key)
    if (!group) {
      group = { key, mode: 'day', label: key, index: null, colour: null, total: 0, colours: [], items: [] }
      groups.set(key, group)
    }
    group.items.push(item)
    group.total = group.items.length
    group.colours.push({ color: item.color, count: 1 })
  }

  return [...groups.values()].sort((a, b) => (b.label ?? '').localeCompare(a.label ?? ''))
}

/** Groups that carry no loaded highlight yet, so the stream can skip rendering an empty rule. */
export function withLoadedItems(groups: HighlightGroup[]): HighlightGroup[] {
  return groups.filter((group) => group.items.length > 0)
}
