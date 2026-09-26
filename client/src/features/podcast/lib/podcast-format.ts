import { i18n } from '@/i18n'
import { formatDate, formatNumber } from '@/i18n/formatters'

export function formatPodcastDuration(seconds: number | null): string {
  const t = i18n.global.t
  if (seconds === null || !Number.isFinite(seconds)) return t('podcast.labels.durationUnavailable')
  // Flooring to minutes prints "0m" for anything shorter than one, which is wrong for the trailers
  // and stingers real feeds carry. Only a genuinely zero-length episode should read as zero.
  if (seconds > 0 && seconds < 60) return t('podcast.labels.durationSeconds', { seconds: formatNumber(Math.round(seconds)) })
  const totalMinutes = Math.floor(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0
    ? t('podcast.labels.durationHoursMinutes', { hours: formatNumber(hours), minutes: formatNumber(minutes) })
    : t('podcast.labels.durationMinutes', { minutes: formatNumber(minutes) })
}

/** Playback clock for seek positions and chapter offsets: H:MM:SS above an hour, M:SS below. */
export function formatPlaybackClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const remainder = total % 60
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
    : `${minutes}:${remainder.toString().padStart(2, '0')}`
}

export function formatPodcastDate(value: string | null): string {
  if (!value) return i18n.global.t('podcast.labels.unknownDate')
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? i18n.global.t('podcast.labels.unknownDate') : formatDate(date, { dateStyle: 'medium' })
}
