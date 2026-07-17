import type { Ref } from 'vue'
import type { Locale } from '@bookorbit/types'
import { i18n } from '@/i18n'

const numberFormatters = new Map<string, Intl.NumberFormat>()
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()
const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>()
const languageNameFormatters = new Map<Locale, Intl.DisplayNames>()

function activeLocale(): Locale {
  return (i18n.global.locale as Ref<Locale>).value
}

function formatterKey(locale: Locale, options: object): string {
  return `${locale}:${JSON.stringify(options)}`
}

export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  const locale = activeLocale()
  const key = formatterKey(locale, options)
  let formatter = numberFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options)
    numberFormatters.set(key, formatter)
  }
  return formatter.format(value)
}

export function formatDate(value: Date | number, options: Intl.DateTimeFormatOptions = {}): string {
  const locale = activeLocale()
  const key = formatterKey(locale, options)
  let formatter = dateTimeFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options)
    dateTimeFormatters.set(key, formatter)
  }
  return formatter.format(value)
}

export function formatDateTime(value: Date | number): string {
  return formatDate(value, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options: Intl.RelativeTimeFormatOptions = { numeric: 'auto' },
): string {
  const locale = activeLocale()
  const key = formatterKey(locale, options)
  let formatter = relativeTimeFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, options)
    relativeTimeFormatters.set(key, formatter)
  }
  return formatter.format(value, unit)
}

export function formatLanguageName(value: string): string {
  const locale = activeLocale()
  let formatter = languageNameFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' })
    languageNameFormatters.set(locale, formatter)
  }
  try {
    return formatter.of(value) ?? value
  } catch {
    return value
  }
}
