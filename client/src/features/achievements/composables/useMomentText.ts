import { useI18n } from 'vue-i18n'
import type { MomentMessage, MomentValue } from '../lib/achievement-moments'

/** Resolves a moment or record message, translating any message nested in its values first. */
export function useMomentText() {
  const { t } = useI18n()

  function resolve(message: MomentMessage): string {
    const values: Record<string, string | number> = {}
    for (const [name, value] of Object.entries(message.values)) values[name] = resolveValue(value)
    return t(message.key, values)
  }

  function resolveValue(value: MomentValue): string | number {
    return typeof value === 'object' ? resolve(value) : value
  }

  return { momentText: resolve }
}
