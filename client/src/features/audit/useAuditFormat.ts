import { useI18n } from 'vue-i18n'
import type { AuditLogEntry } from '@bookorbit/types'
import { formatDate } from '@/i18n/formatters'
import { getAuditActionLabelKey } from './audit-actions'
import { getAuditTargetView, type AuditTargetView } from './audit-display'
import { getAuditResourceLabelKey } from './audit-resources'
import { localDayKey } from './audit-sets'

/** Translated words for audit rows: action names, target names, days and times. */
export function useAuditFormat() {
  const { t } = useI18n()

  /** An action this build has no name for shows its code, which still says what happened. */
  function actionLabel(action: string): string {
    const key = getAuditActionLabelKey(action)
    return key === 'audit.unknownAction' ? action : t(key)
  }

  function resourceLabel(resource: string): string {
    return t(getAuditResourceLabelKey(resource))
  }

  function targetOf(entry: AuditLogEntry): AuditTargetView | null {
    return getAuditTargetView(entry, {
      untitled: t('audit.untitledBook'),
      resource: resourceLabel,
      withId: (resource, id) => t('audit.target.withId', { type: resourceLabel(resource), id }),
    })
  }

  function dayDate(day: string): Date {
    const [year, month, date] = day.split('-').map(Number)
    return new Date(year!, month! - 1, date!)
  }

  /** "Today", "Yesterday", or the weekday. */
  function dayTitle(day: string, now = new Date()): string {
    if (day === localDayKey(now)) return t('audit.day.today')
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (day === localDayKey(yesterday)) return t('audit.day.yesterday')
    return formatDate(dayDate(day), { weekday: 'long' })
  }

  /** The date under the title: the full date for Today and Yesterday, the month and day otherwise. */
  function dayDetail(day: string, now = new Date()): string {
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const relative = day === localDayKey(now) || day === localDayKey(yesterday)
    return formatDate(dayDate(day), relative ? { weekday: 'long', month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric' })
  }

  function dayShort(day: string): string {
    return formatDate(dayDate(day), { month: 'short', day: 'numeric' })
  }

  function dateShort(value: string): string {
    return formatDate(new Date(value), { month: 'short', day: 'numeric' })
  }

  function time(value: string): string {
    return formatDate(new Date(value), { hour: 'numeric', minute: '2-digit' })
  }

  function timeWithSeconds(value: string): string {
    return formatDate(new Date(value), { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  }

  function fullDate(value: string): string {
    return formatDate(new Date(value), {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    })
  }

  return { actionLabel, resourceLabel, targetOf, dayTitle, dayDetail, dayShort, dateShort, time, timeWithSeconds, fullDate }
}
