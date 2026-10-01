import { formatDate } from '@/i18n/formatters'
import { parseCronToHuman } from '@/features/library/utils/cron'
import { describeSchedule } from '@/features/library/utils/library-summary'

type Translate = (key: string, params?: Record<string, unknown>) => string

/** Jan 2, 2000 was a Sunday, so adding a cron weekday (0 = Sunday) lands on that day. */
function sampleDate(hour: number, minute: number, weekday = 0): Date {
  return new Date(2000, 0, 2 + weekday, hour, minute)
}

/**
 * A schedule as the editor names it ("Weekly · Mon 12:00 AM"), plus the full cron description for the
 * tooltip. Schedules the presets cannot name keep the full description as their label. Cron runs in the
 * server's time zone, the same as the sentence it replaces.
 */
export function formatSchedule(cron: string | null | undefined, t: Translate, locale: string): { label: string; title: string } | null {
  if (!cron) return null
  const sentence = parseCronToHuman(cron, locale) ?? cron
  const summary = describeSchedule(cron)
  if (!summary) return { label: sentence, title: sentence }
  const preset = t(`library.creator.schedule.presets.${summary.preset}`)
  if (summary.preset === 'daily') {
    const time = formatDate(sampleDate(summary.hour, summary.minute), { hour: 'numeric', minute: '2-digit' })
    return { label: t('settings.admin.libraries.schedule.at', { preset, time }), title: sentence }
  }
  if (summary.preset === 'weekly') {
    const date = sampleDate(summary.hour, summary.minute, summary.weekday)
    const day = formatDate(date, { weekday: 'short' })
    const time = formatDate(date, { hour: 'numeric', minute: '2-digit' })
    return { label: t('settings.admin.libraries.schedule.weeklyAt', { preset, day, time }), title: sentence }
  }
  return { label: preset, title: sentence }
}
