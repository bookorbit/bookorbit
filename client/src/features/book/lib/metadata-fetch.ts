import type { MetadataProviderInfo, MetadataProviderKey } from '@bookorbit/types'

export { getProviderColor, providerBadgeStyle, providerActivePillStyle } from '@/lib/provider-colors'

const COVER_PROXY_PATH = '/api/v1/books/cover/proxy'

export function getProviderLabel(provider: MetadataProviderKey, providers: readonly MetadataProviderInfo[]): string {
  return providers.find((p) => p.key === provider)?.label ?? provider
}

function currentOrigin(): string | null {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin
  if (typeof location !== 'undefined' && location.origin) return location.origin
  return null
}

export function toDisplayCoverUrl(url: string | null | undefined): string {
  const raw = url?.trim() ?? ''
  if (!raw) return ''
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw

  const origin = currentOrigin()

  try {
    const parsed = origin ? new URL(raw, origin) : new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return raw
    if (parsed.pathname === COVER_PROXY_PATH) return raw

    if (origin) {
      const pageOrigin = new URL(origin).origin
      if (parsed.origin === pageOrigin) return raw
    } else if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
      return raw
    }

    return `${COVER_PROXY_PATH}?url=${encodeURIComponent(parsed.toString())}`
  } catch {
    return raw
  }
}

export function hideOnError(e: Event): void {
  ;(e.target as HTMLImageElement).style.visibility = 'hidden'
}
