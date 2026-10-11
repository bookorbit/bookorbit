import { toast } from 'vue-sonner'
import type { MetadataCacheServedProvider } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { formatListParts } from '@/i18n/formatters'

export type ProviderLabelResolver = (provider: string) => string

function identityLabel(provider: string): string {
  return provider
}

/** "Google Books and Amazon" in the active locale, without hardcoding English separators. */
export function formatProviderSentenceList(labels: string[]): string {
  return formatListParts(labels)
    .map((part) => part.value)
    .join('')
}

/** Tells the user which providers could not be reached, so the saved answer they got is not mistaken for a live one. */
export function cacheFallbackMessage(
  providers: readonly MetadataCacheServedProvider[],
  labelOf: ProviderLabelResolver = identityLabel,
): string | null {
  const labels = [...new Set(providers.map((entry) => entry.provider))].map((provider) => labelOf(provider))
  if (labels.length === 0) return null
  return i18n.global.t('metadataCache.fallback.usedSaved', { count: labels.length, providers: formatProviderSentenceList(labels) })
}

export function showCacheFallbackToast(providers: readonly MetadataCacheServedProvider[], labelOf: ProviderLabelResolver = identityLabel): boolean {
  const message = cacheFallbackMessage(providers, labelOf)
  if (!message) return false
  toast.warning(message, { closeButton: true })
  return true
}
