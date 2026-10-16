import type { AuditLogEntry } from '@bookorbit/types'

/** A row in the ledger: one person's consecutive events on one target, or a run of the same sign-in action. */
export interface AuditEventSet {
  id: number
  /** The newest event; the row shows its time and target. */
  first: AuditLogEntry
  /** Newest first. */
  items: AuditLogEntry[]
  /** Each action in the set with how often it occurred, in order of first appearance. */
  actions: Array<{ action: string; count: number }>
  day: string
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The viewer's calendar day for a timestamp, as YYYY-MM-DD. */
export function localDayKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function setKey(entry: AuditLogEntry): string {
  if (entry.resource && entry.resourceId !== null) return `${entry.resource}:${entry.resourceId}`
  return `action:${entry.action}:${entry.ip ?? ''}`
}

/**
 * Folds the page's events into rows. Events join the row above when the same person did them to the
 * same target on the same day, at most `gapMinutes` apart. Events with no target, such as sign-ins,
 * fold by action and address for the whole day.
 */
export function foldAuditEvents(entries: AuditLogEntry[], gapMinutes = 5): AuditEventSet[] {
  const sets: AuditEventSet[] = []
  let lastKey = ''
  for (const entry of entries) {
    const day = localDayKey(entry.createdAt)
    const key = setKey(entry)
    const current = sets[sets.length - 1]
    const previous = current?.items[current.items.length - 1]
    const closeEnough =
      previous !== undefined &&
      (!entry.resource || entry.resourceId === null || (Date.parse(previous.createdAt) - Date.parse(entry.createdAt)) / 60_000 <= gapMinutes)
    if (current && previous && previous.actorUsername === entry.actorUsername && lastKey === key && current.day === day && closeEnough) {
      current.items.push(entry)
      const known = current.actions.find((item) => item.action === entry.action)
      if (known) known.count++
      else current.actions.push({ action: entry.action, count: 1 })
      continue
    }
    sets.push({ id: entry.id, first: entry, items: [entry], actions: [{ action: entry.action, count: 1 }], day })
    lastKey = key
  }
  return sets
}

export function groupByDay<T>(items: T[], dayOf: (item: T) => string): Array<{ day: string; items: T[] }> {
  const groups: Array<{ day: string; items: T[] }> = []
  for (const item of items) {
    const day = dayOf(item)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(item)
    else groups.push({ day, items: [item] })
  }
  return groups
}
