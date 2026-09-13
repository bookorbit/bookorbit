import cronstrue from 'cronstrue'

export function parseCronToHuman(cron: string | null | undefined, locale: string): string | null {
  if (!cron) return null
  try {
    const use24HourTimeFormat = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 === false
    return cronstrue.toString(cron, { use24HourTimeFormat, verbose: false })
  } catch {
    return cron
  }
}
