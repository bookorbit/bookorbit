import type { ProviderConfigurations } from '@bookorbit/types'

/**
 * The medium a source supplies metadata for. Sources are picked by medium ("I want
 * audiobook narrators"), not alphabetically, so the list is sectioned the same way.
 */
export type ProviderGroupId = 'books' | 'audiobooks' | 'comics' | 'regional'

export const PROVIDER_GROUP_ORDER: ProviderGroupId[] = ['books', 'audiobooks', 'comics', 'regional']

export interface ProviderFieldDef {
  key: string
  label: string
  type: 'text' | 'password' | 'select'
  options?: string[]
  placeholder?: string
  helper?: string
  /** Editable while the provider is still off, because enabling it depends on this value. */
  alwaysEditable?: boolean
  widthClass?: string
}

export interface ProviderEnableRequirement {
  isConfigured: (config: ProviderConfigurations) => boolean
  blockedMessage: string
  requiresPassingTest?: boolean
  missingTestMessage?: string
}

export interface ProviderRowDef {
  key: keyof ProviderConfigurations
  label: string
  group: ProviderGroupId
  hint?: string
  fields: ProviderFieldDef[]
  enableRequirement?: ProviderEnableRequirement
}

/** A provider slice of the draft, addressed by field key rather than by concrete shape. */
export type ProviderDraftEntry = { enabled: boolean } & Record<string, unknown>

export const AMAZON_DOMAINS = [
  'amazon.com',
  'amazon.co.uk',
  'amazon.de',
  'amazon.fr',
  'amazon.it',
  'amazon.es',
  'amazon.ca',
  'amazon.com.au',
  'amazon.co.jp',
  'amazon.in',
  'amazon.com.br',
  'amazon.com.mx',
  'amazon.nl',
  'amazon.se',
  'amazon.pl',
  'amazon.sg',
  'amazon.ae',
  'amazon.sa',
  'amazon.tr',
]

export const AUDIBLE_DOMAINS = [
  'audible.com',
  'audible.co.uk',
  'audible.de',
  'audible.fr',
  'audible.it',
  'audible.es',
  'audible.ca',
  'audible.com.au',
  'audible.co.jp',
  'audible.in',
]

export const KOBO_COUNTRIES = ['us', 'ca', 'gb', 'au', 'nz', 'de', 'fr', 'it', 'es', 'nl', 'pt', 'br', 'jp']
export const KOBO_LANGUAGES = ['en', 'fr', 'de', 'it', 'es', 'nl', 'pt', 'ja', 'all']

const SELECT_WIDTH = 'sm:w-44'
const WIDE_SELECT_WIDTH = 'sm:w-52'
const SECRET_WIDTH = 'sm:w-[26rem]'

export const PROVIDER_FIELD_WIDTHS = { SELECT_WIDTH, WIDE_SELECT_WIDTH, SECRET_WIDTH } as const

/** How a source is doing right now, shown as one chip per row. */
export type ProviderChipKind = 'active' | 'ready' | 'setup' | 'throttled'

export interface ProviderChipView {
  kind: ProviderChipKind
  label: string
  /** Spelled-out state for the tooltip and assistive tech when the label is a bare duration. */
  title?: string
}
