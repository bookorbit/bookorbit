import type { Component } from 'vue'
import { Calendar, Hash, Link, ToggleLeft, Type } from '@lucide/vue'
import type { CustomMetadataFieldType } from '@bookorbit/types'
import { formatDate, formatRelativeTime as formatLocaleRelativeTime } from '@/i18n/formatters'

type CustomFieldTypeMeta = {
  label: string
  icon: Component
  example: string
  badgeClass: string
}

export const CUSTOM_FIELD_TYPE_META: Record<CustomMetadataFieldType, CustomFieldTypeMeta> = {
  text: {
    label: 'Text',
    icon: Type,
    example: 'e.g. Original Title',
    badgeClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
  url: {
    label: 'URL',
    icon: Link,
    example: 'e.g. https://example.com',
    badgeClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  number: {
    label: 'Number',
    icon: Hash,
    example: 'e.g. 42',
    badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  date: {
    label: 'Date',
    icon: Calendar,
    example: 'e.g. 2024-01-31',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  boolean: {
    label: 'Boolean',
    icon: ToggleLeft,
    example: 'Yes / No toggle',
    badgeClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  },
}

const RELATIVE_TIME_DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
]

export function formatRelativeTime(isoString: string): string {
  let duration = (new Date(isoString).getTime() - Date.now()) / 1000
  for (const division of RELATIVE_TIME_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatLocaleRelativeTime(Math.round(duration), division.unit)
    }
    duration /= division.amount
  }
  return formatLocaleRelativeTime(Math.round(duration), 'year')
}

export function formatAbsoluteDateTime(isoString: string): string {
  return formatDate(new Date(isoString), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
