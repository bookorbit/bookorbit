import type { MetadataProviderInfo, MetadataProviderKey } from '@projectx/types'

export function getProviderLabel(provider: MetadataProviderKey, providers: MetadataProviderInfo[]): string {
  return providers.find((p) => p.key === provider)?.label ?? provider
}

export function hideOnError(e: Event): void {
  ;(e.target as HTMLImageElement).style.visibility = 'hidden'
}

/** Brand colors for each provider - used for pill/badge tinting. */
const PROVIDER_COLORS: Record<string, string> = {
  google: '#34A853',
  goodreads: '#06B6D4',
  amazon: '#FF9900',
  hardcover: '#4F47E5',
  openLibrary: '#E83B2A',
}

const DEFAULT_COLOR = 'oklch(0.5 0.01 0)'

export function getProviderColor(provider: string): string {
  return PROVIDER_COLORS[provider] ?? DEFAULT_COLOR
}

function makeProviderPillStyle(color: string, bgPct: number, outlinePct: number): Record<string, string> {
  return {
    backgroundColor: `color-mix(in srgb, ${color} ${bgPct}%, transparent)`,
    color,
    outlineColor: `color-mix(in srgb, ${color} ${outlinePct}%, transparent)`,
    outlineWidth: '1px',
    outlineStyle: 'solid',
  }
}

export function providerBadgeStyle(provider: string): Record<string, string> {
  return makeProviderPillStyle(getProviderColor(provider), 12, 30)
}

export function providerActivePillStyle(provider: string): Record<string, string> {
  return makeProviderPillStyle(getProviderColor(provider), 22, 45)
}
