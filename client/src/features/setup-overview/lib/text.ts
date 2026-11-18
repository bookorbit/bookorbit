import { SETUP_TEXT_RAW, type SetupText } from '@bookorbit/types'
import { useI18n } from 'vue-i18n'

import { formatNumber } from '@/i18n/formatters'

/** A key this build does not know, read back as words rather than as a blank. */
function fallback(key: string): string {
  const last = key.split('.').pop() ?? key
  const spaced = last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Dollar amounts the server marked as money, formatted for the reader's locale. */
function withMoney(text: SetupText): Record<string, string | number> {
  const values = { ...text.values }
  for (const name of text.money ?? []) {
    const value = values[name]
    if (typeof value === 'number') {
      values[name] = formatNumber(value, { style: 'currency', currency: 'USD', maximumFractionDigits: Number.isInteger(value) ? 0 : 2 })
    }
  }
  return values
}

/**
 * Resolves the server's text codes against the catalog.
 *
 * A newer server may name a message this build has never heard of; that costs one line its wording,
 * never the page. Names people and providers wrote come through untranslated.
 */
export function useSetupText() {
  const { t, te } = useI18n()
  return (text: SetupText | null | undefined): string => {
    if (!text) return ''
    if (text.key === SETUP_TEXT_RAW) return String(text.values?.text ?? '')
    return te(text.key) ? t(text.key, withMoney(text)) : fallback(text.key)
  }
}
