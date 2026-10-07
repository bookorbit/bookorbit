import type { Library } from '@bookorbit/types'

/**
 * File kinds BookOrbit can write metadata into. Audio tags are written whether or not the cover is,
 * so audio counts on its own toggle. The all-files scope widens which files are written, not which
 * kinds, so it does not count here.
 */
export const WRITE_FAMILY_FLAGS = [
  'fileWriteEpubEnabled',
  'fileWriteFb2Enabled',
  'fileWritePdfEnabled',
  'fileWriteCbxEnabled',
  'fileWriteKindleEnabled',
  'fileWriteAudioEnabled',
  'fileWriteReadAlongEnabled',
] as const

export type FileWriteFlags = Pick<Library, (typeof WRITE_FAMILY_FLAGS)[number]>

export function writtenKindCount(flags: FileWriteFlags): number {
  return WRITE_FAMILY_FLAGS.filter((flag) => flags[flag]).length
}

export type SchedulePreset = 'hourly' | 'every6Hours' | 'every12Hours' | 'daily' | 'weekly'

/** A schedule the editor's presets can name, with the time it fires for the daily and weekly ones. */
export type ScheduleSummary =
  | { preset: 'hourly' | 'every6Hours' | 'every12Hours' }
  | { preset: 'daily'; hour: number; minute: number }
  | { preset: 'weekly'; hour: number; minute: number; weekday: number }

const INTEGER = /^\d{1,2}$/

/**
 * Names a cron expression by the editor's presets when one fits. Daily and weekly keep their exact time, so
 * `0 2 * * *` is still "Daily" rather than falling back to a sentence. Anything else is left to the caller,
 * which shows the full cron description instead.
 */
export function describeSchedule(cron: string | null | undefined): ScheduleSummary | null {
  const fields = cron?.trim().split(/\s+/)
  if (!fields || fields.length !== 5) return null
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string]
  if (dayOfMonth !== '*' || month !== '*') return null
  if (minute === '0' && dayOfWeek === '*') {
    if (hour === '*') return { preset: 'hourly' }
    if (hour === '*/6') return { preset: 'every6Hours' }
    if (hour === '*/12') return { preset: 'every12Hours' }
  }
  if (!INTEGER.test(minute) || !INTEGER.test(hour)) return null
  const m = Number(minute)
  const h = Number(hour)
  if (m > 59 || h > 23) return null
  if (dayOfWeek === '*') return { preset: 'daily', hour: h, minute: m }
  if (!/^[0-7]$/.test(dayOfWeek)) return null
  return { preset: 'weekly', hour: h, minute: m, weekday: Number(dayOfWeek) % 7 }
}

/** The editor's schedule presets, in the order its picker lists them. */
export const SCHEDULE_PRESET_CRONS: { preset: SchedulePreset; cron: string }[] = [
  { preset: 'hourly', cron: '0 * * * *' },
  { preset: 'every6Hours', cron: '0 */6 * * *' },
  { preset: 'every12Hours', cron: '0 */12 * * *' },
  { preset: 'daily', cron: '0 0 * * *' },
  { preset: 'weekly', cron: '0 0 * * 1' },
]
