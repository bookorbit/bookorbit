import cronstrue from 'cronstrue'

export function parseCronToHuman(cron: string | null | undefined, locale: string): string | null {
  if (!cron) return null
  try {
    const browserTimeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions()
    const localeTimeFormat = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions()
    const browserLanguage = new Intl.Locale(browserTimeFormat.locale).language
    const localeLanguage = new Intl.Locale(localeTimeFormat.locale).language
    const use24HourTimeFormat = (browserLanguage === localeLanguage ? browserTimeFormat : localeTimeFormat).hour12 === false
    return cronstrue.toString(cron, { use24HourTimeFormat, verbose: false })
  } catch {
    return cron
  }
}
