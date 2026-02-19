import type { MetadataProviderInfo, MetadataProviderKey } from '@projectx/types'

export function getProviderLabel(provider: MetadataProviderKey, providers: MetadataProviderInfo[]): string {
  return providers.find((p) => p.key === provider)?.label ?? provider
}

export function hideOnError(e: Event): void {
  (e.target as HTMLImageElement).style.visibility = 'hidden'
}
