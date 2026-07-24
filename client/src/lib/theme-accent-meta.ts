import { ACCENT_IDS, type Accent } from '@bookorbit/types'

export type AccentTone = 'vivid' | 'pastel'
export type AccentPrimaryDef = readonly [lightL: number, lightC: number, darkL: number, darkC: number]

export interface AccentOption {
  id: Accent
  label: string
  labelKey: string
  color: string
}

export interface AccentPair {
  vivid: AccentOption
  pastel: AccentOption
}

interface AccentMetaDefinition {
  label: string
  tone: AccentTone
  hue: number
  primary: AccentPrimaryDef
}

const ACCENT_META_BY_ID: Record<Accent, AccentMetaDefinition> = {
  white: { label: 'White', tone: 'vivid', hue: 0, primary: [0.2, 0, 0.985, 0] },
  grey: { label: 'Grey', tone: 'pastel', hue: 0, primary: [0.55, 0, 0.75, 0] },
  scarlet: { label: 'Scarlet', tone: 'vivid', hue: 2, primary: [0.58, 0.25, 0.74, 0.2] },
  rosewater: { label: 'Rosewater', tone: 'pastel', hue: 2, primary: [0.7, 0.125, 0.8, 0.11] },
  vermilion: { label: 'Vermilion', tone: 'vivid', hue: 28, primary: [0.62, 0.24, 0.77, 0.19] },
  salmon: { label: 'Salmon', tone: 'pastel', hue: 28, primary: [0.74, 0.12, 0.83, 0.1] },
  rose: { label: 'Rose', tone: 'vivid', hue: 15, primary: [0.57, 0.24, 0.73, 0.2] },
  copper: { label: 'Copper', tone: 'vivid', hue: 56, primary: [0.65, 0.19, 0.79, 0.16] },
  sand: { label: 'Sand', tone: 'pastel', hue: 56, primary: [0.77, 0.095, 0.85, 0.09] },
  orange: { label: 'Orange', tone: 'vivid', hue: 42, primary: [0.64, 0.22, 0.78, 0.18] },
  chartreuse: { label: 'Chartreuse', tone: 'vivid', hue: 106, primary: [0.76, 0.2, 0.83, 0.17] },
  pear: { label: 'Pear', tone: 'pastel', hue: 106, primary: [0.82, 0.1, 0.88, 0.09] },
  marigold: { label: 'Marigold', tone: 'vivid', hue: 82, primary: [0.76, 0.18, 0.84, 0.15] },
  flax: { label: 'Flax', tone: 'pastel', hue: 82, primary: [0.82, 0.09, 0.88, 0.08] },
  wasabi: { label: 'Wasabi', tone: 'vivid', hue: 130, primary: [0.68, 0.19, 0.79, 0.16] },
  sprout: { label: 'Sprout', tone: 'pastel', hue: 130, primary: [0.8, 0.095, 0.85, 0.09] },
  amber: { label: 'Amber', tone: 'vivid', hue: 70, primary: [0.72, 0.17, 0.82, 0.17] },
  malachite: { label: 'Malachite', tone: 'vivid', hue: 152, primary: [0.56, 0.18, 0.73, 0.15] },
  aloe: { label: 'Aloe', tone: 'pastel', hue: 152, primary: [0.68, 0.09, 0.79, 0.08] },
  yellow: { label: 'Yellow', tone: 'vivid', hue: 95, primary: [0.75, 0.18, 0.84, 0.16] },
  viridian: { label: 'Viridian', tone: 'vivid', hue: 171, primary: [0.54, 0.17, 0.73, 0.14] },
  foam: { label: 'Foam', tone: 'pastel', hue: 171, primary: [0.68, 0.085, 0.79, 0.08] },
  turquoise: { label: 'Turquoise', tone: 'vivid', hue: 188, primary: [0.58, 0.18, 0.75, 0.15] },
  aqua: { label: 'Aqua', tone: 'pastel', hue: 188, primary: [0.7, 0.09, 0.81, 0.08] },
  lime: { label: 'Lime', tone: 'vivid', hue: 118, primary: [0.64, 0.2, 0.77, 0.18] },
  green: { label: 'Green', tone: 'vivid', hue: 142, primary: [0.527, 0.18, 0.72, 0.18] },
  'acid-green': { label: 'Acid Green', tone: 'vivid', hue: 112, primary: [0.7, 0.2, 0.82, 0.17] },
  pistachio: { label: 'Pistachio', tone: 'pastel', hue: 112, primary: [0.8, 0.11, 0.88, 0.09] },
  emerald: { label: 'Emerald', tone: 'vivid', hue: 162, primary: [0.52, 0.17, 0.72, 0.15] },
  teal: { label: 'Teal', tone: 'vivid', hue: 180, primary: [0.52, 0.18, 0.74, 0.16] },
  'electric-blue': { label: 'Electric Blue', tone: 'vivid', hue: 230, primary: [0.54, 0.24, 0.73, 0.19] },
  'baby-blue': { label: 'Baby Blue', tone: 'pastel', hue: 230, primary: [0.68, 0.12, 0.79, 0.1] },
  cyan: { label: 'Cyan', tone: 'vivid', hue: 197, primary: [0.52, 0.2, 0.75, 0.17] },
  jade: { label: 'Jade', tone: 'vivid', hue: 155, primary: [0.62, 0.2, 0.78, 0.17] },
  ultramarine: { label: 'Ultramarine', tone: 'vivid', hue: 247, primary: [0.5, 0.28, 0.7, 0.22] },
  cornflower: { label: 'Cornflower', tone: 'pastel', hue: 247, primary: [0.68, 0.14, 0.76, 0.12] },
  iris: { label: 'Iris', tone: 'vivid', hue: 270, primary: [0.52, 0.25, 0.72, 0.21] },
  bluebell: { label: 'Bluebell', tone: 'pastel', hue: 270, primary: [0.68, 0.125, 0.78, 0.12] },
  purple: { label: 'Purple', tone: 'vivid', hue: 284, primary: [0.51, 0.25, 0.72, 0.21] },
  thistle: { label: 'Thistle', tone: 'pastel', hue: 284, primary: [0.68, 0.125, 0.78, 0.12] },
  blue: { label: 'Blue', tone: 'vivid', hue: 263, primary: [0.487, 0.25, 0.72, 0.2] },
  indigo: { label: 'Indigo', tone: 'vivid', hue: 276, primary: [0.51, 0.26, 0.72, 0.22] },
  violet: { label: 'Violet', tone: 'vivid', hue: 292, primary: [0.491, 0.27, 0.72, 0.23] },
  amethyst: { label: 'Amethyst', tone: 'vivid', hue: 302, primary: [0.54, 0.24, 0.73, 0.2] },
  mauve: { label: 'Mauve', tone: 'pastel', hue: 302, primary: [0.68, 0.12, 0.79, 0.11] },
  fuchsia: { label: 'Fuchsia', tone: 'vivid', hue: 312, primary: [0.56, 0.27, 0.75, 0.22] },
  raspberry: { label: 'Raspberry', tone: 'vivid', hue: 344, primary: [0.56, 0.23, 0.74, 0.19] },
  'rose-quartz': { label: 'Rose Quartz', tone: 'pastel', hue: 344, primary: [0.68, 0.115, 0.8, 0.1] },
  pink: { label: 'Pink', tone: 'vivid', hue: 328, primary: [0.56, 0.26, 0.75, 0.22] },
  coral: { label: 'Coral', tone: 'pastel', hue: 15, primary: [0.69, 0.12, 0.79, 0.11] },
  peach: { label: 'Peach', tone: 'pastel', hue: 42, primary: [0.76, 0.11, 0.84, 0.1] },
  butter: { label: 'Butter', tone: 'pastel', hue: 70, primary: [0.82, 0.085, 0.88, 0.09] },
  lemon: { label: 'Lemon', tone: 'pastel', hue: 95, primary: [0.82, 0.09, 0.88, 0.09] },
  celadon: { label: 'Celadon', tone: 'pastel', hue: 118, primary: [0.76, 0.1, 0.83, 0.1] },
  sage: { label: 'Sage', tone: 'pastel', hue: 142, primary: [0.68, 0.09, 0.78, 0.1] },
  mint: { label: 'Mint', tone: 'pastel', hue: 162, primary: [0.68, 0.085, 0.78, 0.08] },
  seafoam: { label: 'Seafoam', tone: 'pastel', hue: 180, primary: [0.68, 0.09, 0.8, 0.09] },
  powder: { label: 'Powder', tone: 'pastel', hue: 197, primary: [0.68, 0.1, 0.81, 0.09] },
  'sea-glass': { label: 'Sea Glass', tone: 'pastel', hue: 155, primary: [0.74, 0.1, 0.84, 0.09] },
  periwinkle: { label: 'Periwinkle', tone: 'pastel', hue: 263, primary: [0.68, 0.125, 0.78, 0.11] },
  wisteria: { label: 'Wisteria', tone: 'pastel', hue: 276, primary: [0.68, 0.13, 0.78, 0.12] },
  lavender: { label: 'Lavender', tone: 'pastel', hue: 292, primary: [0.68, 0.135, 0.78, 0.13] },
  orchid: { label: 'Orchid', tone: 'pastel', hue: 312, primary: [0.68, 0.135, 0.81, 0.12] },
  blush: { label: 'Blush', tone: 'pastel', hue: 328, primary: [0.68, 0.13, 0.81, 0.12] },
}

export const DEFAULT_ACCENT: Accent = 'blue'

export function resolveAccent(accent: string | null | undefined): Accent {
  if (!accent) return DEFAULT_ACCENT
  return (ACCENT_IDS as readonly string[]).includes(accent) ? (accent as Accent) : DEFAULT_ACCENT
}

export function isPastelAccent(accent: string | null | undefined): boolean {
  const id = resolveAccent(accent)
  return ACCENT_META_BY_ID[id].tone === 'pastel'
}

function getAccentPreviewColor(definition: AccentMetaDefinition): string {
  const [lightL, lightC, darkL, darkC] = definition.primary
  return `light-dark(oklch(${lightL} ${lightC} ${definition.hue}), oklch(${darkL} ${darkC} ${definition.hue}))`
}

const ALL_ACCENT_OPTIONS: readonly AccentOption[] = ACCENT_IDS.map((id) => {
  const definition = ACCENT_META_BY_ID[id]
  return {
    id,
    label: definition.label,
    labelKey: `settings.appearance.theme.accents.${id}`,
    color: getAccentPreviewColor(definition),
  }
})

const ACCENT_PAIR_IDS = [
  ['white', 'grey'],
  ['orange', 'peach'],
  ['copper', 'sand'],
  ['amber', 'butter'],
  ['marigold', 'flax'],
  ['yellow', 'lemon'],
  ['chartreuse', 'pear'],
  ['acid-green', 'pistachio'],
  ['lime', 'celadon'],
  ['wasabi', 'sprout'],
  ['green', 'sage'],
  ['malachite', 'aloe'],
  ['jade', 'sea-glass'],
  ['emerald', 'mint'],
  ['viridian', 'foam'],
  ['teal', 'seafoam'],
  ['turquoise', 'aqua'],
  ['cyan', 'powder'],
  ['electric-blue', 'baby-blue'],
  ['ultramarine', 'cornflower'],
  ['blue', 'periwinkle'],
  ['iris', 'bluebell'],
  ['indigo', 'wisteria'],
  ['purple', 'thistle'],
  ['violet', 'lavender'],
  ['amethyst', 'mauve'],
  ['fuchsia', 'orchid'],
  ['pink', 'blush'],
  ['raspberry', 'rose-quartz'],
  ['scarlet', 'rosewater'],
  ['rose', 'coral'],
  ['vermilion', 'salmon'],
] as const satisfies readonly (readonly [Accent, Accent])[]

const OPTIONS_BY_ID = new Map(ALL_ACCENT_OPTIONS.map((option) => [option.id, option]))

export const ACCENT_PAIRS: readonly AccentPair[] = ACCENT_PAIR_IDS.map(([vividId, pastelId]) => ({
  vivid: OPTIONS_BY_ID.get(vividId)!,
  pastel: OPTIONS_BY_ID.get(pastelId)!,
}))

export const ACCENT_VIVID: readonly AccentOption[] = ACCENT_PAIRS.map((pair) => pair.vivid)

export const ACCENT_PASTEL: readonly AccentOption[] = ACCENT_PAIRS.map((pair) => pair.pastel)

const PAIRS_PER_GROUP = ACCENT_PAIRS.length / 2
const FIRST_PAIR_GROUP = ACCENT_PAIRS.slice(0, PAIRS_PER_GROUP)
const SECOND_PAIR_GROUP = ACCENT_PAIRS.slice(PAIRS_PER_GROUP)

export const ACCENT_ROWS: readonly (readonly AccentOption[])[] = [
  FIRST_PAIR_GROUP.map((pair) => pair.vivid),
  FIRST_PAIR_GROUP.map((pair) => pair.pastel),
  SECOND_PAIR_GROUP.map((pair) => pair.vivid),
  SECOND_PAIR_GROUP.map((pair) => pair.pastel),
]

export const ACCENT_OPTIONS: readonly AccentOption[] = [...ACCENT_VIVID, ...ACCENT_PASTEL]

export const ACCENT_HUE: Record<Accent, number> = Object.fromEntries(ACCENT_IDS.map((id) => [id, ACCENT_META_BY_ID[id].hue])) as Record<
  Accent,
  number
>

export const ACCENT_PRIMARY: Record<Accent, AccentPrimaryDef> = Object.fromEntries(
  ACCENT_IDS.map((id) => [id, ACCENT_META_BY_ID[id].primary]),
) as Record<Accent, AccentPrimaryDef>
