import type { MetadataProviderKey } from '@bookorbit/types'
import { providerAppearance } from './provider-appearance'

const PROVIDER_HEX: Record<string, string> = {
  google: '#34A853',
  goodreads: '#00d8d1',
  amazon: '#FF9900',
  hardcover: '#7772ff',
  openLibrary: '#49a4ff',
  itunes: '#ff4f5d',
  audible: '#FF8A00',
  audnexus: '#FF5ADD',
  librofm: '#62B9B6',
  comicvine: '#ffdb0f',
  ranobedb: '#a78cff',
  kobo: '#e23434',
  lubimyczytac: '#f47373',
  aladin: '#3E7FFF',
  auto: '#8B5CF6',
}

// An external provider that declares no colour gets a tuned theme token, legible in both themes.
const DEFAULT_COLOR = 'var(--muted-foreground)'

export const PROVIDER_SHORT_LABELS: Record<string, string> = {
  google: 'Google',
  amazon: 'Amazon',
  goodreads: 'Goodreads',
  hardcover: 'Hardcover',
  openLibrary: 'Open Lib',
  itunes: 'iTunes',
  audible: 'Audible',
  audnexus: 'AudNexus',
  librofm: 'Libro.fm',
  comicvine: 'ComicVine',
  ranobedb: 'RanobeDB',
  kobo: 'Kobo',
  lubimyczytac: 'LubimyCzytac',
  aladin: 'Aladin',
  auto: 'Fetched',
}

/** A compact name for chips: the built-in short form, else the provider's own label, else its key. */
export function providerShortLabel(provider: string, label?: string | null): string {
  return PROVIDER_SHORT_LABELS[provider] ?? label ?? provider
}

export function getProviderColor(provider: string): string {
  return PROVIDER_HEX[provider] ?? providerAppearance(provider)?.color ?? DEFAULT_COLOR
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

/**
 * Chips resolve their fill, ink and ring from the theme rather than from the raw brand
 * hex, because the hex alone fails contrast on a light surface. Pair with the
 * `provider-chip` class; a chip for an unusable provider pairs with
 * `provider-chip-skipped` instead and ignores the custom property.
 */
export function providerChipStyle(provider: MetadataProviderKey | string): Record<string, string> {
  return { '--provider-color': getProviderColor(provider) }
}
