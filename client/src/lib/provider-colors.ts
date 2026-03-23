import type { MetadataProviderKey } from '@projectx/types'

const PROVIDER_HEX: Record<string, string> = {
  google: '#34A853',
  goodreads: '#00d8d1',
  amazon: '#FF9900',
  hardcover: '#7772ff',
  openLibrary: '#49a4ff',
  itunes: '#ff4f5d',
  audible: '#FF8A00',
  audnexus: '#FF5ADD',
  comicvine: '#ffdb0f',
  auto: '#8B5CF6',
}

const DEFAULT_COLOR = 'oklch(0.5 0.01 0)'

export const PROVIDER_SHORT_LABELS: Record<string, string> = {
  google: 'Google',
  amazon: 'Amazon',
  goodreads: 'Goodreads',
  hardcover: 'Hardcover',
  openLibrary: 'Open Lib',
  itunes: 'iTunes',
  audible: 'Audible',
  audnexus: 'AudNexus',
  comicvine: 'ComicVine',
  auto: 'Fetched',
}

export function getProviderColor(provider: string): string {
  return PROVIDER_HEX[provider] ?? DEFAULT_COLOR
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

export function providerChipStyle(provider: MetadataProviderKey | string, disabled = false): Record<string, string> {
  const color = getProviderColor(provider)
  const style = makeProviderPillStyle(color, disabled ? 6 : 14, disabled ? 15 : 35)
  if (disabled) style.opacity = '0.75'
  return style
}
